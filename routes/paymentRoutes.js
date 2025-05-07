const express = require("express");
const axios = require('axios');

const router = express.Router();
const PAYMENT_PASSCODE = process.env.WORLDLINE_PAYMENT_PASSCODE;
const PROFILE_PASSCODE = process.env.WORLDLINE_PROFILE_PASSCODE;
const PAYMENT_URL = 'https://api.na.bambora.com/v1/payments';
const PROFILE_URL = 'https://api.na.bambora.com/v1/profiles';

router.post('/process', async (req, res) => {
    try {
        const { amount, code, name } = req.body;

        const profile = await axios.post(PROFILE_URL, {
            token : {
                name, 
                code
            }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Passcode '+ PROFILE_PASSCODE
            }
        });
        console.log(profile);

        const paymentData = {
            amount,
            payment_method: "payment_profile",
            payment_profile: {
                customer_code : profile.data.customer_code,
                card_id : profile.data.code,
                complete: "true"
            }
        };

        const paymentResponse = await axios.post(PAYMENT_URL, paymentData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Passcode '+ PAYMENT_PASSCODE
            }
        })

        return res.status(200).json({ success: true, id: paymentResponse.data.order_number });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.response ? error.response.data.message : error.message });
    }
});


module.exports = router;