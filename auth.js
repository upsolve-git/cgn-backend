const jwt = require('jsonwebtoken');

const jwtSecret = 'your_jwt_secret';

const generateToken = (id,email) => {
    return jwt.sign({ id: id, username: email }, jwtSecret, { expiresIn: '1h' });
}
const verifyAuth = async (req, res, next) => {

    const token = req.cookies.cgntoken;
    console.log("in auth", req.cookies)
    if (token == null) return res.status(401).json({ message: 'No token provided' });
    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
    
        req.user = user;
        next(); 
      });
}

module.exports = {
    verifyAuth, 
    generateToken,
} 