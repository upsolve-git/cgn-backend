const express = require('express');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const createConnection =  require("./db.js")
const { OAuth2Client } = require('google-auth-library'); 
const util = require('util');
const multer = require('multer');
const {saveFiletoBucket} = require('./s3.js')
const path = require('path');
const dotenv = require('dotenv') 
const cookieParser = require('cookie-parser');
const { generateToken, verifyAuth } = require('./auth.js');

dotenv.config()  

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
    // console.log(req)
  },
  
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now()+path.extname(file.originalname))  }
});

const upload = multer({ storage: storage });

const client = new OAuth2Client('YOUR_WEB_CLIENT_ID.apps.googleusercontent.com');

const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({extended:false}))
app.use(cors({
  origin: 'https://www.canadiangelnails.com',
  origin: 'http://localhost:3000', 
  credentials: true 
}));
app.use(cookieParser());
let db

async function performDatabaseOperations() {
  db = await createConnection();
//   const createTableQuery = `INSERT INTO Categories (category_name) VALUES ("test_category")`; 
//   const insertproductsquery = `INSERT INTO products 
// ( name, product_type, description, price, discounted_price_percentage, available_sizes, product_imgs_id, category_id)
// VALUES 
// ( 'your_name3', 'your_product_type', 'your_description', 20, 10.0, 'your_available_sizes', 'your_product_imgs_id', 1);
// `

// const insertbestquery = 'INSERT INTO newSellers (product_id) VALUES (2)'
//   const createUsersTableQuery = `CREATE TABLE users (
//     id INT AUTO_INCREMENT PRIMARY KEY,     -- Unique identifier for each user
//     email VARCHAR(255) NOT NULL UNIQUE,    -- Email address (must be unique)
//     password VARCHAR(255) NOT NULL,        -- Password (encrypted)
//     accType ENUM('Business', 'Personal') NOT NULL, -- Account type (admin or user)
//     firstName VARCHAR(100) NOT NULL,      -- First name
//     lastName VARCHAR(100) NOT NULL,       -- Last name
//     phone VARCHAR(15),                     -- Phone number
//     countryCode VARCHAR(5),                -- Country code for phone number
//     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Record creation timestamp
//     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP -- Record update timestamp
// );` 

//   const createcartquery = `CREATE TABLE cart (
//     product_id INT NOT NULL,
//     image VARCHAR(255) NOT NULL,
//     name VARCHAR(255) NOT NULL,
//     price DECIMAL(10, 2) NOT NULL,
//     quantity INT NOT NULL,
//     user_id INT NOT NULL,
//     PRIMARY KEY (product_id, user_id)
// );` 
  // db.query("SHOW tables", (err, results) => {
  //   if (err) {
  //     console.error('Error executing query:', err.stack);
  //     return;
  //   }
  //   console.log('Table created successfully:', results);
  // });

} 

performDatabaseOperations().catch(err => console.error('Operation error:', err));

app.get("/getauth", verifyAuth, (req, res) => {
  return res.status(200).json({message: 'authenticated'})
}) 

app.post('/signup', async (req, res) => {
  const { firstName, lastName, phone, email, password, accType, countryCode} = req.body;
  console.log(req.body)
  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = 'INSERT INTO users (email, password, firstName, lastName, phone, accType, countryCode) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [email, hashedPassword, firstName, lastName, phone, accType, countryCode], (err, result) => {
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

    const token = generateToken(user.id, user.email);
    console.log(token)
    res.cookie('cgntoken', token, {
      httpOnly: true,
      secure: true, // Change to true if using HTTPS
      sameSite: 'None',
      maxAge: 3600000,
      path: '/' // Ensure the cookie is set for all paths
    });

  res.status(200).json({ message: 'Login successful!' });
  });
});

app.post('/logout', (req, res) => {
  console.log("in logout")
  res.clearCookie('cgntoken', {
    httpOnly: true, 
    secure: true, // Change to true if using HTTPS
    sameSite: 'None', 
    path: '/' // Make sure this matches the path used when the cookie was set
  });

  res.status(200).json({ message: 'Logout successful, cookie cleared!' });
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

app.post('/addproduct', upload.single('image'), async(req, res) => {
  console.log("in prodcts add")
  const {name, product_type, description, price, discounted_price_percentage, available_sizes, category_id} = req.body
  try {
    const location = await saveFiletoBucket(req.file)
    
    const sql = 'INSERT INTO products (name, product_type, description, price, discounted_price_percentage, product_imgs_id, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [name, product_type, description, price, discounted_price_percentage, location, category_id], (err, result) => {
      if (err) {
        console.error('Error inserting product:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'Product added successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.get('/products', async(req, res) => {
  try {
    const productDetailsQuery = `SELECT 
    products.product_id, 
    products.name, 
    products.product_type, 
    products.description, 
    products.price, 
    products.discounted_price_percentage,
    products.product_imgs_id,
    Categories.category_name
FROM 
    products
INNER JOIN 
    Categories 
ON 
    products.category_id = Categories.category_id;`; 
    let query = util.promisify(db.query).bind(db); 
    try {
      const result = await query(productDetailsQuery)
      res.status(200).json(result)
    } catch (error) {
      console.error('Error fetching products:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.post('/addcategory', async(req, res) => {
  const {category_name} = req.body
  try {
    const sql = 'INSERT INTO Categories (category_name) VALUES (?)';
    db.query(sql, [category_name], (err, result) => {
      if (err) {
        console.error('Error inserting category:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'Category added successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
}) 

app.get('/categories', async(req, res) => {
  try {
    const categoriesQuery = 'SELECT * FROM Categories'; 
    let query = util.promisify(db.query).bind(db); 
    try {
      const result = await query(categoriesQuery)
      res.status(200).json(result)
    } catch (error) {
      console.error('Error fetching categories:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
}) 

app.post('/addbestseller', async(req, res) => {
  const {product_id} = req.body
  try {
    const sql = 'INSERT INTO bestSellers (product_id) VALUES (?)';
    db.query(sql, [product_id], (err, result) => {
      if (err) {
        console.error('Error inserting bestseller:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'added successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
}) 

app.post('/deletebestseller', async(req, res) => {
  const {product_id} = req.body
  try {
    const sql = 'INSERT INTO bestSellers (product_id) VALUES (?)';
    db.query(sql, [product_id], (err, result) => {
      if (err) {
        console.error('Error inserting bestseller:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'added successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
}) 

app.post('/addnewseller', async(req, res) => {
  const {product_id} = req.body
  try {
    const sql = 'INSERT INTO newSellers (product_id) VALUES (?)';
    db.query(sql, [product_id], (err, result) => {
      if (err) {
        console.error('Error inserting newseller:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'added successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.post('/deletenewseller', async(req, res) => {
  const {product_id} = req.body
  try {
    const sql = 'INSERT INTO newSellers (product_id) VALUES (?)';
    db.query(sql, [product_id], (err, result) => {
      if (err) {
        console.error('Error inserting newseller:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'added successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.get('/users', async(req, res) => {
  try {
    const categoriesQuery = 'SELECT * FROM users'; 
    let query = util.promisify(db.query).bind(db); 
    try {
      const result = await query(categoriesQuery)
      res.status(200).json(result)
    } catch (error) {
      console.error('Error fetching users:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
}) 

app.get('/getcart/:id', verifyAuth, async(req, res) => {
  try {
    const {id} = req.params
    const cartQuery = 'SELECT * FROM cart where user_id=?'; 
    let query = util.promisify(db.query).bind(db); 
    try {
      const result = await query(cartQuery,[req.user.id])
      res.status(200).json(result)
    } catch (error) {
      console.error('Error fetching cart:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
}) 

app.post('/updateCart', verifyAuth, async(req, res) => {
  const {product_id, image, name, price, quantity, user_id} = req.body
  try {
    let query = util.promisify(db.query).bind(db); 
    try {
      const checkquery = 'SELECT * FROM cart where user_id=? and product_id=?';
      const result = await query(checkquery,[req.user.id, product_id])
      console.log(result)
      if(result.length == 0) {
        const updatequery = 'INSERT INTO cart(user_id, product_id, image, name, price, quantity) VALUES(?, ?, ?, ?, ?, ?)'
        const result = await query(updatequery, [req.user.id, product_id, image, name, price, quantity]);
        res.status(200)
      } else {
        const updateQuery = 'UPDATE cart SET quantity = ? WHERE user_id = ? AND product_id = ?';
        const result = await query(updateQuery, [quantity, req.user.id, product_id]);
        res.status(200)
      }
    } catch (error) {
      console.error('Error fetching users:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch(error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.post('/deletefromcart', verifyAuth, async(req, res) => {
  try {
    console.log("in delete cart")
    const {product_id, user_id} = req.body
    const deleteQuery = 'DELETE FROM cart WHERE user_id = ? AND product_id = ?';
    let query = util.promisify(db.query).bind(db); 
    try {
      const result = await query(deleteQuery,[req.user.id, product_id])
      res.status(200).json(result)
    } catch (error) {
      console.error('Error deleting in cart:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
}) 

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
