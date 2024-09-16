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
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now()+path.extname(file.originalname))
  }
});

const upload = multer({ storage: storage }).array('files', 10);

const client = new OAuth2Client('YOUR_WEB_CLIENT_ID.apps.googleusercontent.com');

const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({extended:false}))

const allowedOrigins = ['https://www.canadiangelnails.com', 'http://localhost:3000'];

const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());
let db

async function performDatabaseOperations() {
  db = await createConnection();
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

    const sql = 'INSERT INTO Users (email, password, first_name, last_name, phone, account_type, country_code) VALUES (?, ?, ?, ?, ?, ?, ?)';
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

  const sql = 'SELECT * FROM Users WHERE email = ?';
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

    const token = generateToken(user.user_id, user.email);
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

app.post('/addproduct', async(req, res) => { 
  upload(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(500).json({message : "error in uploading files"})
    } else if (err) {
      return res.status(500).json({message : "error in uploading files"})
    } 

    console.log("Adding New product")
    const {name, product_type, description, price, discounted_price, category_id, color, shade, HEXCode} = req.body
    try {
      let query = util.promisify(db.query).bind(db); 
      const productsql = 'INSERT INTO Products (name, product_type, description, price, discounted_price, category_id) VALUES (?, ?, ?, ?, ?, ?)';
      const addProductResult = await query(productsql, [name, product_type, description, price, discounted_price, category_id]); 

      if (addProductResult.affectedRows == 0) {
        console.log("failed in adding product")
        res.status(500).json({ message: 'Failed to add product' });
        return; 
      } 

      const product_id = addProductResult.insertId
      const colors = color.split(',').map(item => item.trim()); 
      const shades = shade.split(',').map(item => item.trim());
      const HEXCodes = HEXCode.split(',').map(item => item.trim());
      let colors_id = []

      for (let i = 0; i < colors.length; i++) {
        const checkColorsSql = 'Select * from Colors where color_name = ? and shade_name = ? and code = ?'
        const checkcolorresult = await query(checkColorsSql, [colors[i], shades[i], HEXCode[i]]) 
        if(checkcolorresult.length > 0) {
          colors_id.push(checkcolorresult[0].color_id);
        } else {
          const colorsql = 'INSERT INTO Colors(color_name, shade_name, code) VALUES(?, ?, ?) IF NOT EXISTS'; 
          const addcolorsqlresult = await query(colorsql, [colors[i], shades[i], HEXCode[i]]) 

          if(addcolorsqlresult.affectedRows == 0) {
            console.log("failed in adding colors")
            res.status(500).json({ message: 'Failed to add product' });
            return
          } 
          colors_id.push(addcolorsqlresult.insertId)
        } 
      }

      for (let i =0; i< colors_id.length; i++) {
        const productcolormappingquery = 'INSERT INTO ProductColorMappings(product_id, color_id) VALUES(?,?)' 
        const result = await query(productcolormappingquery, [product_id, colors_id[i]]) 
        if(result.affectedRows == 0) {
          console.log("failed in mapping products")
          res.status(500).json({ message: 'Failed to add product' });
          return; 
        } 
      } 

      const files = req.files
      let locations = []
      cnt = 1
      files.forEach(file => {
        const location = saveFiletoBucket(file, product_id, cnt)
        locations.push(location)
        cnt += 1
      }) 

      for (let i = 0; i< locations.length; i++) {
        const productimagesquery = "INSERT INTO ProductImages(product_id, image) VALUES(?,?)" 
        const result = await query(productimagesquery, [product_id, locations[i]]) 
        if(result.affectedRows == 0) {
          console.log("failed in storing product images")
          res.status(500).json({ message: 'Failed to add product' });
          return; 
        } 
      }

      res.status(200).json({message : "added product"})
    } catch (error) {
      console.log(error)
      res.status(500).json({ message: 'Server error' });
    }
  });

})

app.get('/products', async(req, res) => {
  try {
    const productDetailsQuery = `SELECT 
    Products.product_id, 
    Products.name, 
    Products.product_type, 
    Products.description, 
    Products.price, 
    Products.discounted_price,
    Categories.category_name
FROM 
    Products
INNER JOIN 
    Categories 
ON 
    Products.category_id = Categories.category_id;`; 
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
    const sql = 'INSERT INTO BestSellers (product_id) VALUES (?)';
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
    const sql = 'INSERT INTO BestSellers (product_id) VALUES (?)';
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
    const sql = 'INSERT INTO NewSellers (product_id) VALUES (?)';
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
    const sql = 'INSERT INTO NewSellers (product_id) VALUES (?)';
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
    const categoriesQuery = 'SELECT * FROM Users'; 
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

app.get('/getcart', verifyAuth, async(req, res) => {
  try {
    const cartQuery = 'SELECT * FROM CartItems where user_id=?'; 
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
      const checkquery = 'SELECT * FROM CartItems where user_id=? and product_id=?';
      const result = await query(checkquery,[req.user.id, product_id])
      console.log(result)
      if(result.length == 0) {
        const updatequery = 'INSERT INTO CartItems(user_id, product_id, quantity) VALUES(?, ?, ?)'
        const result = await query(updatequery, [req.user.id, product_id, quantity]);
        res.status(200)
      } else {
        const updateQuery = 'UPDATE CartItems SET quantity = ? WHERE user_id = ? AND product_id = ?';
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
//get products and get cartitems 