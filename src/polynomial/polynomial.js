import {BigBuffer} from "ffjavascript";
import {DOMAIN_SIZE} from "../custom_gates/range_check_gate.js";

export class Polynomial {
    constructor(coefficients = new BigBuffer(0), Fr, logger) {
        this.coef = coefficients;
        this.Fr = Fr;
        this.logger = logger;
    }

    static async fromBuffer(buffer, Fr, logger) {
        let coefficients = await Fr.ifft(buffer);

        return new Polynomial(coefficients, Fr, logger);
    }

    blindCoefficients(blindingFactors) {
        blindingFactors = blindingFactors || [];

        const blindedCoefficients = new BigBuffer((this.length + blindingFactors.length) * this.Fr.n8);
        blindedCoefficients.set(this.coef, 0);
        for (let i = 0; i < blindingFactors.length; i++) {
            blindedCoefficients.set(
                this.Fr.add(
                    blindedCoefficients.slice((this.length + i) * this.Fr.n8, (this.length + i + 1) * this.Fr.n8),
                    blindingFactors[i]
                ),
                (this.length + i) * this.Fr.n8
            );
            blindedCoefficients.set(
                this.Fr.sub(
                    blindedCoefficients.slice(i * this.Fr.n8, (i + 1) * this.Fr.n8),
                    blindingFactors[i]
                ),
                i * this.Fr.n8
            );
        }
        this.coef = blindedCoefficients;
    }

    static async to4T(buffer, domainSize, blindingFactors, Fr) {
        blindingFactors = blindingFactors || [];
        let a = await Fr.ifft(buffer);

        const a4 = new BigBuffer(domainSize * 4 * Fr.n8);
        a4.set(a, 0);

        const a1 = new BigBuffer((domainSize + blindingFactors.length) * Fr.n8);
        a1.set(a, 0);
        for (let i = 0; i < blindingFactors.length; i++) {
            a1.set(
                Fr.add(
                    a1.slice((domainSize + i) * Fr.n8, (domainSize + i + 1) * Fr.n8),
                    blindingFactors[i]
                ),
                (domainSize + i) * Fr.n8
            );
            a1.set(
                Fr.sub(
                    a1.slice(i * Fr.n8, (i + 1) * Fr.n8),
                    blindingFactors[i]
                ),
                i * Fr.n8
            );
        }
        const A4 = await Fr.fft(a4);

        return [a1, A4];
    }

    get length() {
        let length = this.coef.byteLength / this.Fr.n8;
        if (length !== Math.floor(this.coef.byteLength / this.Fr.n8)) {
            throw new Error("Polynomial coefficients buffer has incorrect size");
        }
        if (0 === length) {
            this.logger.warn("Polynomial has length zero");
        }
        return length;
    }

    degree() {
        for (let i = this.length - 1; i > 0; i--) {
            const i_n8 = i * this.Fr.n8;
            if (!this.Fr.eq(this.Fr.zero, this.coef.slice(i_n8, i_n8 + this.Fr.n8))) {
                return i;
            }
        }

        return 0;
    }

    evaluate(point) {
        let res = this.Fr.zero;

        for (let i = this.length; i > 0; i--) {
            let i_n8 = (i - 1) * this.Fr.n8;
            const currentCoefficient = this.coef.slice(i_n8, i_n8 + this.Fr.n8);
            res = this.Fr.add(currentCoefficient, this.Fr.mul(res, point));
        }

        return res;
    }

    add(polynomial, blindingValue) {
        // Due to performance reasons currently we only accept to add polynomials with equal or smaller size
        if (polynomial.length > this.length) {
            throw new Error("Add a greater size polynomial is not allowed");
        }

        for (let i = 0; i < this.length; i++) {
            const i_n8 = i * this.Fr.n8;

            const a = i <= this.degree() ? this.coef.slice(i_n8, i_n8 + this.Fr.n8) : this.Fr.zero;
            let b = i <= polynomial.degree() ? polynomial.coef.slice(i_n8, i_n8 + this.Fr.n8) : this.Fr.zero;
            if (blindingValue !== undefined) {
                b = this.Fr.mul(b, blindingValue);
            }
            this.coef.set(this.Fr.add(a, b), i_n8);
        }
    }

    sub(polynomial, blindingValue) {
        // Due to performance reasons currently we only accept to add polynomials with equal or smaller size
        if (polynomial.length > this.length) {
            throw new Error("Add a greater size polynomial is not allowed");
        }

        for (let i = 0; i < this.length; i++) {
            const i_n8 = i * this.Fr.n8;

            const a = i < this.degree() ? this.coef.slice(i_n8, i_n8 + this.Fr.n8) : this.Fr.zero;
            let b = i < polynomial.degree() ? polynomial.coef.slice(i_n8, i_n8 + this.Fr.n8) : this.Fr.zero;
            if (blindingValue !== undefined) {
                b = this.Fr.mul(b, blindingValue);
            }
            this.coef.set(this.Fr.sub(a, b), i_n8);
        }
    }

    mulScalar(value) {
        for (let i = 0; i < this.length; i++) {
            const i_n8 = i * this.Fr.n8;

            this.coef.set(this.Fr.mul(this.coef.slice(i_n8, i_n8 + this.Fr.n8), value), i_n8);
        }
    }

    addScalar(value) {
        const currentValue = 0 === this.length ? this.Fr.zero : this.coef.slice(0, this.Fr.n8);
        this.coef.set(this.Fr.add(currentValue, value), 0);
    }

    subScalar(value) {
        const currentValue = 0 === this.length ? this.Fr.zero : this.coef.slice(0, this.Fr.n8);
        this.coef.set(this.Fr.sub(currentValue, value), 0);
    }

    // Divide polynomial by X - value
    divByXValue(value) {
        const coefs = new BigBuffer(this.length * this.Fr.n8);

        coefs.set(this.Fr.zero, (this.length - 1) * this.Fr.n8);
        coefs.set(this.coef.slice((this.length - 1) * this.Fr.n8, this.length * this.Fr.n8), (this.length - 2) * this.Fr.n8);
        for (let i = this.length - 3; i >= 0; i--) {
            let i_n8 = i * this.Fr.n8;
            coefs.set(
                this.Fr.add(
                    this.coef.slice(i_n8 + this.Fr.n8, i_n8 + 2 * this.Fr.n8),
                    this.Fr.mul(value, coefs.slice(i_n8 + this.Fr.n8, i_n8 + 2 * this.Fr.n8))
                ),
                i * this.Fr.n8
            );
        }
        if (!this.Fr.eq(
            this.coef.slice(0, this.Fr.n8),
            this.Fr.mul(this.Fr.neg(value), coefs.slice(0, this.Fr.n8))
        )) {
            // throw new Error("Polynomial does not divide");
        }

        this.coef = coefs;
    }

    async divZh() {
        const coefs = new BigBuffer(DOMAIN_SIZE * 4 * this.Fr.n8);

        if (this.logger) this.logger.debug("dividing T/Z_H");
        for (let i = 0; i < DOMAIN_SIZE; i++) {
            const i_n8 = i * this.Fr.n8;
            coefs.set(this.Fr.neg(this.coef.slice(i_n8, i_n8 + this.Fr.n8)), i_n8);
        }

        for (let i = DOMAIN_SIZE; i < DOMAIN_SIZE * 4; i++) {
            const i_n8 = i * this.Fr.n8;

            const a = this.Fr.sub(
                coefs.slice((i - DOMAIN_SIZE) * this.Fr.n8, (i - DOMAIN_SIZE) * this.Fr.n8 + this.Fr.n8),
                this.coef.slice(i_n8, i_n8 + this.Fr.n8)
            );
            coefs.set(a, i_n8);
            if (i > (DOMAIN_SIZE * 3 - 4)) {
                if (!this.Fr.isZero(a)) {
                    //throw new Error("range_check T Polynomial is not divisible");
                }
            }
        }

        return new Polynomial(coefs, this.Fr);
    }

    split(numChunks, numElementsChunk, blindingFactors) {
        if (numChunks <= 1) {
            throw new Error(`Polynomials can't be split in ${numChunks} parts`);
        }

        const chunkByteLength = numElementsChunk * this.Fr.n8;

        // Check polynomial can be split in numChunks parts of chunkSize bytes...
        if (this.coef.byteLength / chunkByteLength <= numChunks - 1) {
            throw new Error(`Polynomial is short to be split in ${numChunks} parts of ${numElementsChunk} coefficients each.`);
        }

        let res = [];
        for (let i = 0; i < numChunks; i++) {
            const isLast = (numChunks - 1) === i;
            const byteLength = isLast ? this.coef.byteLength - ((numChunks - 1) * chunkByteLength) : chunkByteLength + this.Fr.n8;

            res[i] = new Polynomial(new BigBuffer(byteLength), this.Fr, this.logger);
            const fr = i * chunkByteLength;
            const to = isLast ? this.coef.byteLength : (i + 1) * chunkByteLength;
            res[i].coef.set(this.coef.slice(fr, to), 0);

            // Add a blinding factor as higher degree
            if (!isLast) {
                res[i].coef.set(blindingFactors[i], chunkByteLength);
            }

            // Sub blinding factor to the lowest degree
            if (0 !== i) {
                const lowestDegree = this.Fr.sub(res[i].coef.slice(0, this.Fr.n8), blindingFactors[i - 1]);
                res[i].coef.set(lowestDegree, 0);
            }
        }

        return res;

        // // compute t_low(X)
        // let polTLow = new BigBuffer((chunkSize + 1) * n8r);
        // polTLow.set(t.slice(0, zkey.domainSize * n8r), 0);
        // // Add blinding scalar b_10 as a new coefficient n
        // polTLow.set(ch.b[10], zkey.domainSize * n8r);
        //
        // // compute t_mid(X)
        // let polTMid = new BigBuffer((zkey.domainSize + 1) * n8r);
        // polTMid.set(t.slice(zkey.domainSize * n8r, zkey.domainSize * 2 * n8r), 0);
        // // Subtract blinding scalar b_10 to the lowest coefficient of t_mid
        // const lowestMid = Fr.sub(polTMid.slice(0, n8r), ch.b[10]);
        // polTMid.set(lowestMid, 0);
        // // Add blinding scalar b_11 as a new coefficient n
        // polTMid.set(ch.b[11], zkey.domainSize * n8r);
        //
        // // compute t_high(X)
        // let polTHigh = new BigBuffer((zkey.domainSize + 6) * n8r);
        // polTHigh.set(t.slice(zkey.domainSize * 2 * n8r, (zkey.domainSize * 3 + 6) * n8r), 0);
        // //Subtract blinding scalar b_11 to the lowest coefficient of t_high
        // const lowestHigh = Fr.sub(polTHigh.slice(0, n8r), ch.b[11]);
        // polTHigh.set(lowestHigh, 0);
        //
        // proof.T1 = await expTau(polTLow, "multiexp T1");
        // proof.T2 = await expTau(polTMid, "multiexp T2");
        // proof.T3 = await expTau(polTHigh, "multiexp T3");
    }

    toDebugArray(buffer, Fr) {
        const length = buffer.byteLength / Fr.n8;
        let res = [];
        for (let i = 0; i < length; i++) {
            res.push(Fr.toString(buffer.slice(i * Fr.n8, (i + 1) * Fr.n8)));
        }

        return res;
    }
}
