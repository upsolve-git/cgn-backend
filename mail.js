const nodemailer = require("nodemailer");
const dotenv = require('dotenv') 

dotenv.config()  

const feedbackNotificationTemplate = (name, email, feedback) => {
    return `
    <!DOCTYPE html>
<html>
<head>
    <title>New Customer Feedback</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f9f9f9;
        }
        .email-container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        .header {
            text-align: center;
            background-color: #ff9800;
            color: white;
            padding: 10px 0;
            border-radius: 8px 8px 0 0;
        }
        .content {
            margin: 20px 0;
            text-align: left;
        }
        .content p {
            font-size: 16px;
            line-height: 1.6;
            color: #333;
        }
        .footer {
            text-align: center;
            font-size: 12px;
            color: #888;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1>New Customer Feedback</h1>
        </div>
        <div class="content">
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Feedback:</strong></p>
            <p>${feedback}</p>
        </div>
        <div class="footer">
            <p>This is an automated notification. Please review the feedback and respond if necessary.</p>
        </div>
    </div>
</body>
</html>
    `;
};


const sendMail = async(name, email, feedback) => {
    try {   
  
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL,
            pass: process.env.PASSWORD
        } 
      });
  
      const mailConfigurations = {
        from: process.env.EMAIL,
        to: process.env.EMAIL,
        subject:"Feedback",
        html:feedbackNotificationTemplate(name, email, feedback)
      };
  
      await transporter.sendMail(mailConfigurations);
      console.log("Email Sent Successfully");
    } catch (error) {
      console.error("Error sending email:", error.message);
      throw error
    }
}

module.exports = {
    sendMail
}