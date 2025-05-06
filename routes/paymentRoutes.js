const express = require("express");
const axios = require('axios');

const router = express.Router();
const PAYMENT_PASSCODE = process.env.WORLDLINE_PAYMENT_PASSCODE;
const PROFILE_PASSCODE = process.env.WORLDLINE_PROFILE_PASSCODE;
const PAYMENT_URL = 'https://api.na.bambora.com/v1/payments';
const PROFILE_URL = 'https://api.na.bambora.com/v1/profiles';

router.post('/process-payment123', async (req, res) => {
    try {
        const { amount, card } = req.body;
        
        const paymentData = {
            amount,
            payment_method: "card",
            card
        };

        const response = await axios.post(PAYMENT_URL, paymentData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Passcode '+ PAYMENT_PASSCODE
            }
        });

        return res.status(200).json({ success: true, id: response.data.id });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.response ? error.response.data.message : error.message });
    }
});

router.post('/process-payment', async (req, res) => {
    try {
        const { token } = req.body;

        const profileData = {
            token
        }

        const response = await axios.post(PROFILE_URL, profileData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Passcode '+ PROFILE_PASSCODE
            }
        });

        const paymentData = {
            amount,
            payment_method: "payment_profile",
            payment_profile: response.data
        };

        const paymentResponse = await axios.post(PAYMENT_URL, paymentData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Passcode '+ PAYMENT_PASSCODE
            }
        })

        return res.status(200).json({ success: true, id: paymentResponse.data.id });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.response ? error.response.data.message : error.message });
    }
});

module.exports = router;