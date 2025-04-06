import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
import orderRoutes from '../routes/orderRoutes/orderRoutes.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use('/', orderRoutes);

describe('POST /create-payment-intent', () => {
    it('returns a client secret for a valid request', async () => {
        const res = await request(app)
            .post('/create-payment-intent')
            .send({
                amount: 1000,
                currency: 'usd',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.clientSecret).toBeDefined();
    });

    it('returns 400 for missing fields', async () => {
        const res = await request(app)
            .post('/create-payment-intent')
            .send({});

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('Amount and currency are required');
    });
});
