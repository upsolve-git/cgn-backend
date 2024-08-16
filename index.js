const express = require('express');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const createConnection =  require("./db.js")
const { OAuth2Client } = require('google-auth-library'); 
const util = require('util');

const client = new OAuth2Client('YOUR_WEB_CLIENT_ID.apps.googleusercontent.com');

const app = express();
app.use(bodyParser.json());
app.use(cors({
  origin:'*'
}));
let db
const jwtSecret = 'your_jwt_secret';
async function performDatabaseOperations() {
  db = await createConnection();
//   const createTableQuery = `INSERT INTO Categories (category_name) VALUES ("test_category")`; 
//   const insertproductsquery = `INSERT INTO products 
// ( name, product_type, description, price, discounted_price_percentage, available_sizes, product_imgs_id, category_id)
// VALUES 
// ( 'your_name3', 'your_product_type', 'your_description', 20, 10.0, 'your_available_sizes', 'your_product_imgs_id', 1);
// `

// const insertbestquery = 'INSERT INTO newSellers (product_id) VALUES (2)'
//   db.query(insertbestquery, (err, results) => {
//     if (err) {
//       console.error('Error executing query:', err.stack);
//       return;
//     }
//     console.log('Table created successfully:', results);
//   });

} 

performDatabaseOperations().catch(err => console.error('Operation error:', err));

app.post('/signup', async (req, res) => {
  const { first_name, last_name, mobile, username, email, password, account_type } = req.body;
  console.log(req.body)
  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = 'INSERT INTO users (username, email, password, first_name, last_name, mobile, account_type) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [username, email, hashedPassword, first_name, last_name, mobile, account_type], (err, result) => {
      if (err) {
        console.error('Error inserting user:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'User registered successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const sql = 'SELECT * FROM users WHERE email = ?';
  db.query(sql, [email], async (err, results) => {
    if (err) {
      console.error('Error finding user:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = results[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, jwtSecret, { expiresIn: '1h' });

    res.status(200).json({ message: 'Login successful!', token });
  });
});

const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(400).json({ message: 'Invalid token.' });
  }
};

app.get('/profile', authenticateToken, (req, res) => {
  res.json({ message: `Welcome ${req.user.username}! This is your profile.` });
});

app.post('/auth/google', async (req, res) => {
  const { token } = req.body;

  try {
    // Verify the token using Google's OAuth2Client
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
    });
    const payload = ticket.getPayload();

    const { sub, email, name, picture } = payload;

    // Check if user exists in the database
    const sql = 'SELECT * FROM users WHERE google_id = ? OR email = ?';
    db.query(sql, [sub, email], (err, results) => {
      if (err) {
        console.error('Error querying the database:', err);
        return res.status(500).json({ message: 'Database error' });
      }

      if (results.length > 0) {
        // User exists, generate a JWT
        const user = results[0];
        const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '1h' });
        return res.status(200).json({ message: 'Login successful!', token });
      } else {
        // User does not exist, create a new user
        const insertSql = 'INSERT INTO users (google_id, email, name, profile_picture) VALUES (?, ?, ?, ?)';
        db.query(insertSql, [sub, email, name, picture], (err, result) => {
          if (err) {
            console.error('Error inserting new user:', err);
            return res.status(500).json({ message: 'Database error' });
          }

          const token = jwt.sign({ id: result.insertId, email: email }, jwtSecret, { expiresIn: '1h' });
          res.status(201).json({ message: 'User registered and logged in!', token });
        });
      }
    });

  } catch (error) {
    console.error('Error verifying Google token:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
});

app.get('/landingpage', async(req, res) => {
  const bestSellingQuery = 'SELECT product_id FROM bestSellers';
  let productIds; 
  let bestSellingProducts;
  let newproducts; 

  let query = util.promisify(db.query).bind(db); 
  try {
      const result = await query(bestSellingQuery)
      productIds = result.map(row => row.product_id);
    } catch (error) {
      console.error('Error fetching bestSellers products:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  
  const productDetailsQuery = 'SELECT * FROM products WHERE product_id IN (?)'; 

  try {
    const result = await query(productDetailsQuery, [productIds])
    bestSellingProducts = result
  } catch (error) {
    console.error('Error fetching bestSellers products:', error.stack);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
  const newSellingQuery = 'SELECT product_id FROM newSellers';

  try {
    const result = await query(newSellingQuery)
    productIds = result.map(row => row.product_id);
  } catch (error) {
    console.error('Error fetching bestSellers products:', error.stack);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  try {
    const result = await query(productDetailsQuery, [productIds])
    newproducts = result
  } catch (error) {
    console.error('Error fetching bestSellers products:', error.stack);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  return res.status(200).json({"bestSellers" : bestSellingProducts, "newSellers" : newproducts})
})


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
