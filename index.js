const express = require('express');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const bodyParser = require('body-parser');
const createConnection =  require("./db.js")
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

const upload = multer({ storage: storage }).array('images', 10);

const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({extended:false}))
app.use(express.json());

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
  const { email, first_name, last_name } = req.body;

  try {
    const sql = 'SELECT * FROM Users WHERE email = ?';
    db.query(sql, [email], (err, results) => {
      if (err) {
        console.error('Error querying the database:', err);
        return res.status(500).json({ message: 'Database error' });
      }

      if (results.length > 0) {
        const user = results[0];
        const token = generateToken(user.user_id, user.email);
        res.cookie('cgntoken', token, {
          httpOnly: true,
          secure: true, // Change to true if using HTTPS
          sameSite: 'None',
          maxAge: 3600000,
          path: '/' // Ensure the cookie is set for all paths
        });
    
      res.status(200).json({ message: 'Login successful!' });
      } else {
        const insertSql = 'INSERT INTO Users (email, first_name, last_name, account_type) VALUES (?, ?, ?, ?)';
        db.query(insertSql, [email, first_name, last_name, "Personal"], (err, result) => {
          if (err) {
            console.error('Error inserting new user:', err);
            return res.status(500).json({ message: 'Database error' });
          }

          const token = generateToken(result.insertId, email);
          res.cookie('cgntoken', token, {
            httpOnly: true,
            secure: true, // Change to true if using HTTPS
            sameSite: 'None',
            maxAge: 3600000,
            path: '/' // Ensure the cookie is set for all paths
          });
      
        res.status(200).json({ message: 'Login successful!' });
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
    console.log("in add product")
    if (err instanceof multer.MulterError) {
      return res.status(500).json({message : "error in uploading files"})
    } else if (err) {
      return res.status(500).json({message : "error in uploading files"})
    } 

    console.log("Adding New product")
    console.log(req.body.colors)
    const {name, product_type, description, price, discounted_price, discounted_business_price, category_ids, colors} = req.body
    try {
      let query = util.promisify(db.query).bind(db); 
      const productsql = 'INSERT INTO Products (name, product_type, description, price, discounted_price, discounted_business_price) VALUES (?, ?, ?, ?, ?, ?)';
      const addProductResult = await query(productsql, [name, product_type, description, price, discounted_price, discounted_business_price]); 

      if (addProductResult.affectedRows == 0) {
        console.log("failed in adding product")
        res.status(500).json({ message: 'Failed to add product' });
        return; 
      }

      const product_id = addProductResult.insertId

      for (let i = 0; i<category_ids.length; i++) {
        const addcategoryMapping = "INSERT INTO ProductCategoryMappings (category_id, product_id) VALUES(?, ?)";
        const addcategoryMappingresult = await query(addcategoryMapping, [parseInt(category_ids[i] , 10), product_id]);
        if (addcategoryMappingresult.affectedRows == 0) {
          console.log("failed in adding product")
          res.status(500).json({ message: 'Failed to add product' });
          return; 
        }
      }

      
      let colors_id = []
      let parsedColors = JSON.parse(colors)
      for (const color of parsedColors) {
        console.log("colors : ", color.code)
        const checkColorsSql = 'Select * from Colors where color_name = ? and shade_name = ? and code = ?'
        const checkcolorresult = await query(checkColorsSql, [color.color_name, color.shade_name, color.code]) 
        if(checkcolorresult.length > 0) {
          colors_id.push(checkcolorresult[0].color_id);
        } else {
          const colorsql = 'INSERT INTO Colors(color_name, shade_name, code) VALUES(?, ?, ?)'; 
          const addcolorsqlresult = await query(colorsql, [color.color_name, color.shade_name, color.code]) 

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
      let locations = [];
      let cnt = 1;

      for (const file of files) {
        const location = await saveFiletoBucket(file, product_id, cnt);
        console.log("location :", location);
        locations.push(location);
        cnt += 1;
      }

      console.log(locations);
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
        p.product_id,
        p.name,
        p.product_type,
        p.description,
        p.price,
        p.discounted_price,
        p.discounted_business_price,
        GROUP_CONCAT(DISTINCT c.category_name) AS categories,
        GROUP_CONCAT(DISTINCT pi.image) AS images,
        JSON_ARRAYAGG(JSON_OBJECT('color_name', clr.color_name, 'shade_name', clr.shade_name, 'code', clr.code)) AS colors
    FROM 
        Products p
    LEFT JOIN 
        ProductCategoryMappings pcm ON p.product_id = pcm.product_id
    LEFT JOIN 
        Categories c ON pcm.category_id = c.category_id
    LEFT JOIN 
        ProductImages pi ON p.product_id = pi.product_id
    LEFT JOIN 
        ProductColorMappings pcm2 ON p.product_id = pcm2.product_id
    LEFT JOIN 
        Colors clr ON pcm2.color_id = clr.color_id
    GROUP BY 
        p.product_id;`; 
    let query = util.promisify(db.query).bind(db); 
    try {
      let rows = await query(productDetailsQuery)
      let products = []
      for (const row of rows) {
        console.log(row.name)
        products.push({
          product_id: row.product_id,
          name: row.name,
          product_type: row.product_type,
          description: row.description,
          price: row.price,
          discounted_price: row.discounted_price,
          discounted_business_price: row.discounted_business_price,
          categories: row.categories ? row.categories.split(',') : [],  // Convert comma-separated string to array
          images: row.images ? row.images.split(',') : [],              // Convert comma-separated string to array
          colors: row.colors                               // Colors already returned as JSON array
        })
      }
      // const products = rows.foreach(row => ());
      res.status(200).json(products)
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

app.post('/deletecategory', async(req, res) => {
  const {category_id} = req.body
  try {
    const sql = 'DELETE from Categories where category_id = ?';
    db.query(sql, [category_id], (err, result) => {
      if (err) {
        console.error('Error deleting category:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'Category deleted successfully!' });
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
    const sql = 'DELETE from BestSellers where product_id = ?';
    db.query(sql, [product_id], (err, result) => {
      if (err) {
        console.error('Error deleting bestseller:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'deleted successfully!' });
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
    const sql = 'DELETE from NewSellers where product_id = ?';
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
    const cartQuery = `SELECT 
    ci.cart_item_id,
    p.name AS product_name,
    GROUP_CONCAT(DISTINCT pi.image) AS images,
    p.price,
    p.discounted_price,
    p.discounted_business_price,
    ci.quantity,
    (ci.quantity * p.price) AS total_price
FROM 
    CartItems ci
JOIN 
    Products p ON ci.product_id = p.product_id
LEFT JOIN 
    ProductImages pi ON p.product_id = pi.product_id
WHERE 
    ci.user_id = ?
GROUP BY 
    ci.cart_item_id, p.product_id;
`; 
    let query = util.promisify(db.query).bind(db); 
    try {
      const [rows] = await query(cartQuery,[req.user.id])
      const cartItems = rows.map(row => ({
        cart_item_id: row.cart_item_id,
        product_name: row.product_name,
        images: row.images ? row.images.split(',') : [],
        price: row.price,
        discounted_price: row.discounted_price,
        discounted_business_price: row.discounted_business_price,
        quantity: row.quantity,
        total_price: row.total_price
      }));
      res.status(200).json(cartItems)
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
  const {product_id, quantity} = req.body
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
    const {product_id} = req.body
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
