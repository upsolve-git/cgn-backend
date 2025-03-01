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
const { generateToken, verifyAuth, verifyAdminAuth } = require('./auth.js');
const paypal = require('@paypal/checkout-server-sdk');
const { clear } = require('console');


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


let environment = new paypal.core.SandboxEnvironment('AXe6TRZyyOvPyk-LJfTnjVRfhgrqUrShjru1GlfCf96laO8aWKMEUO47kmT509bmygakZi61FxrM13i5', 'EMZMzo1Q67oDQ1mMQKKl8vL09_W0DwEwlGi-rdMvWhBxE5xzx7fp_9Ruq2ndJBSkvcggYPs65_KmiB2S');
let client = new paypal.core.PayPalHttpClient(environment);


app.get("/getauth", verifyAuth, (req, res) => {
  return res.status(200).json({message: 'authenticated'})
}) 

app.get("/getadminauth", verifyAdminAuth, (req, res) => {
  return res.status(200).json({message: 'authenticated'})
}) 

app.post('/signup', async (req, res) => {
  const { firstName, lastName, phone, email, password, accType, countryCode} = req.body;
  console.log(req.body)
  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    let db = await createConnection();
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

app.post('/login', async(req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  let db = await createConnection();
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

app.post('/adminlogin', async(req, res) => {
  const { email, password } = req.body;
  console.log("in admin login")

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  let db = await createConnection();
  const sql = 'SELECT * FROM Admin WHERE email = ?';
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
    res.cookie('cgnadmintoken', token, {
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
  res.clearCookie('cgnadmintoken', {
    httpOnly: true, 
    secure: true, // Change to true if using HTTPS
    sameSite: 'None', 
    path: '/' // Make sure this matches the path used when the cookie was set
  });

  res.status(200).json({ message: 'Logout successful, cookie cleared!' });
});

app.post('/auth/google', async (req, res) => {
  const { email, first_name, last_name } = req.body;
  let db = await createConnection();
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
  let newproducts = []
  let bestSellingProducts = []
  let db = await createConnection();
  try {
    
    const bestSellerProductDetailsQuery = `SELECT 
        p.product_id,
        p.name,
        p.product_type,
        p.description,
        p.price,
        p.discounted_price,
        p.discounted_business_price,
        GROUP_CONCAT(DISTINCT c.category_name) AS categories,
        GROUP_CONCAT(DISTINCT pi.image) AS images,
        JSON_ARRAYAGG(JSON_OBJECT('color_name', clr.color_name, 'shade_name', clr.shade_name, 'code', clr.code, 'color_id', clr.color_id)) AS colors
    FROM 
        Products p
    JOIN
        BestSellers bs ON p.product_id = bs.product_id
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
      let rows = await query(bestSellerProductDetailsQuery)
      for (const row of rows) {
        bestSellingProducts.push({
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
    } catch (error) {
      console.error('Error fetching products:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }

  try {
    const newSellerProductDetailsQuery = `SELECT 
        p.product_id,
        p.name,
        p.product_type,
        p.description,
        p.price,
        p.discounted_price,
        p.discounted_business_price,
        GROUP_CONCAT(DISTINCT c.category_name) AS categories,
        GROUP_CONCAT(DISTINCT pi.image) AS images,
        JSON_ARRAYAGG(JSON_OBJECT('color_name', clr.color_name, 'shade_name', clr.shade_name, 'code', clr.code, 'color_id', clr.color_id)) AS colors
    FROM 
        Products p
    JOIN
        NewSellers ns ON p.product_id = ns.product_id
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
      let rows = await query(newSellerProductDetailsQuery)
      for (const row of rows) {
        newproducts.push({
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
    } catch (error) {
      console.error('Error fetching products:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }

  return res.status(200).json({"bestSellers" : bestSellingProducts, "newSellers" : newproducts})
})

app.post('/addproduct', verifyAdminAuth, async(req, res) => { 
  let db = await createConnection();

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
    let db = await createConnection();

    const productDetailsQuery = `SELECT 
    p.product_id,
    p.name,
    p.product_type,
    p.description,
    p.price,
    p.discounted_price,
    p.discounted_business_price,
    GROUP_CONCAT(DISTINCT c.category_name) AS categories,
    (
        SELECT JSON_ARRAYAGG(image)
        FROM (
            SELECT DISTINCT pi.image 
            FROM ProductImages pi 
            WHERE pi.product_id = p.product_id
        ) AS sub_images
    ) AS images,
    (
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'color_name', sub_clr.color_name,
                'shade_name', sub_clr.shade_name,
                'code', sub_clr.code,
                'color_id', sub_clr.color_id
            )
        )
        FROM (
            SELECT DISTINCT clr.color_name, clr.shade_name, clr.code, clr.color_id
            FROM ProductColorMappings pcm2
            JOIN Colors clr ON pcm2.color_id = clr.color_id
            WHERE pcm2.product_id = p.product_id
        ) AS sub_clr
    ) AS colors
FROM 
    Products p
LEFT JOIN 
    ProductCategoryMappings pcm ON p.product_id = pcm.product_id
LEFT JOIN 
    Categories c ON pcm.category_id = c.category_id
GROUP BY 
    p.product_id;
`; 
    let query = util.promisify(db.query).bind(db); 
    try {
      let rows = await query(productDetailsQuery)
      let products = []
      for (const row of rows) {
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

app.post('/addcategory', verifyAdminAuth, async(req, res) => {
  const {category_name} = req.body
  try {
    let db = await createConnection();

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

app.post('/deletecategory', verifyAdminAuth, async(req, res) => {
  const {category_id} = req.body
  try {
    let db = await createConnection();

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
    let db = await createConnection();

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

app.post('/addbestseller', verifyAdminAuth, async(req, res) => {
  const {product_id} = req.body
  try {
    let db = await createConnection();

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

app.post('/deletebestseller', verifyAdminAuth, async(req, res) => {
  const {product_id} = req.body
  try {
    let db = await createConnection();

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

app.post('/addnewseller', verifyAdminAuth, async(req, res) => {
  const {product_id} = req.body
  try {
    let db = await createConnection();

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

app.post('/deletenewseller', verifyAdminAuth, async(req, res) => {
  const {product_id} = req.body
  try {
    let db = await createConnection();

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

app.get('/users', verifyAdminAuth, async(req, res) => {
  try {
    let db = await createConnection();

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
    let db = await createConnection();

    const cartQuery = `SELECT 
    p.product_id,
    p.price,
    p.name AS product_name,
    GROUP_CONCAT(DISTINCT pi.image) AS images,
    p.discounted_price,
    p.discounted_business_price,
    ci.quantity,
    ci.total,
    clr.shade_name,
    clr.code,
    clr.color_id
FROM 
    CartItems ci
JOIN 
    Products p ON ci.product_id = p.product_id
LEFT JOIN 
    ProductImages pi ON p.product_id = pi.product_id
LEFT JOIN
    Colors clr ON ci.color_id = clr.color_id
WHERE 
    ci.user_id = ?
GROUP BY 
    ci.cart_item_id, p.product_id;
`; 
    let query = util.promisify(db.query).bind(db); 
    try {
      const rows = await query(cartQuery,[req.user.id])
      let cartItems = []
      for(const row of rows) {
        cartItems.push({
        product_id: row.product_id,
        name: row.product_name,
        price:row.price,
        images: row.images ? row.images.split(',') : [],
        discounted_price: row.discounted_price,
        discounted_business_price: row.discounted_business_price,
        quantity: row.quantity,
        total: row.total,
        shade_name: row.shade_name,
        code: row.code,
        color_id: row.color_id
        })
      }
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
  const {product_id, quantity, color_id} = req.body
  try {
    let db = await createConnection();

    console.log(product_id, quantity, color_id)
    let query = util.promisify(db.query).bind(db); 
    try {
      const checkquery = 'SELECT * FROM CartItems where user_id=? and product_id=? and color_id=?';
      const result = await query(checkquery,[req.user.id, product_id, color_id])
      console.log(result)
      if(result.length == 0) {
        const updatequery = 'INSERT INTO CartItems(user_id, product_id, quantity, color_id) VALUES(?, ?, ?, ?)'
        const result = await query(updatequery, [req.user.id, product_id, quantity, color_id]);
        res.status(200).json({ message: 'updated cart' });
      } else {
        const updateQuery = 'UPDATE CartItems SET quantity = ? WHERE user_id = ? AND product_id = ? AND color_id =?';
        const result = await query(updateQuery, [quantity, req.user.id, product_id, color_id]);
        res.status(200).json({ message: 'updated cart' });
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
    let db = await createConnection();

    console.log("in delete cart", req.body)
    let {product_id, color_id} = req.body
    if(!color_id) {color_id = 1}
    const deleteQuery = 'DELETE FROM CartItems WHERE user_id = ? AND product_id = ? AND color_id = ?';
    let query = util.promisify(db.query).bind(db); 
    try {
      const result = await query(deleteQuery,[req.user.id, product_id, color_id])
      console.log(req.user.id, product_id, color_id)
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

app.get('/defaultaddress', verifyAuth, async(req, res) => {
  try {
    let db = await createConnection();

    const addressQuery = 'SELECT * from Address where user_id = ? AND `default` = true'; 
    let query = util.promisify(db.query).bind(db); 
    try {
      const result = await query(addressQuery,[req.user.id])
      res.status(200).json(result)
    } catch (error) {
      console.error('Error fetching Address:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.post('/placeorder', verifyAuth, async(req, res) => {
  try {
    let db = await createConnection();

    const {payment_id, address, cartItems} = req.body

    const checkAddress = `SELECT * from Address where 
user_id = ? AND
full_name = ? AND
address_line1 = ? AND
address_line2 = ? AND
city = ? AND
state = ? AND
country = ? AND
pincode = ? AND
mobile = ?`

    let query = util.promisify(db.query).bind(db); 
    try {
      const result = await query(checkAddress, [req.user.id, address.full_name, address.address_line1, address.address_line2, address.city, address.state, address.country, address.pincode, address.mobile])
      let address_id;
      let order_id;
      console.log(result)
      if(result.length > 0) {
        const updateDefaultInAddress = "UPDATE Address SET `default` = ? WHERE address_id = ?"; 
        await query(updateDefaultInAddress, [address.default, result.address_id])
        address_id = result[0].address_id;
        console.log("Updated Address", address_id)
      } else {
        const insertQuery = 'INSERT INTO Address(full_name, user_id, address_line1, address_line2, city, state, country, pincode, `default`, mobile) VALUES(?,?,?,?,?,?,?,?,?,?)';
        const result = await query(insertQuery, [address.full_name, req.user.id, address.address_line1, address.address_line2, address.city, address.state, address.country, address.pincode, address.default, address.mobile]);
        address_id = result.insertId;
        console.log("Updated Address", address_id)
      }

      let total = 0; 
      for (const item of cartItems) {
        total = total + item.quantity * item.discounted_price
      }

      if(address_id) {
        const createOrderQuery = "INSERT INTO Orders(user_id, order_status, address_id, total, invoice, payment_id, confirmation_date, shipping_date, delivered_date) VALUES(?,?,?,?,?,?, NOW() + INTERVAL 1 DAY, NOW() + INTERVAL 2 DAY, NOW() + INTERVAL 7 DAY)";
        const result = await query(createOrderQuery, [req.user.id, "pending", address_id, total, "", payment_id])
        order_id = result.insertId
      }

      if(order_id) {
        for(const item of cartItems) {
          const createOrderLineQuery = "INSERT INTO OrderLine(order_id, product_id, quantity, color_id) VALUES(?,?,?,?)"
          await query(createOrderLineQuery, [order_id, item.product_id, item.quantity, item.color_id])
        }
      }
      const clearCart = "DELETE from CartItems where user_id = ?"
      await query(clearCart, [req.user.id])
      res.status(200).json({"order_id": order_id})
    } catch (error) {
      console.error('Error fetching Address:', error.stack);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.get("/getorders", verifyAuth, async(req, res) => {
  try {
    let db = await createConnection();

    let query = util.promisify(db.query).bind(db); 
    const getOrdersQuery = `
SELECT 
    o.order_id,
    o.user_id,
    o.invoice,
    o.order_status,
    o.creation_date,
    o.confirmation_date,
    o.shipping_date,
    o.delivered_date,
    ol.product_id,
    GROUP_CONCAT(DISTINCT pi.image) AS images, 
    p.name,
    ol.quantity,
    p.price,
    c.shade_name,
    c.code,
    GROUP_CONCAT(DISTINCT cat.category_name) AS categories  -- Get distinct category names
FROM 
    Orders o
JOIN 
    OrderLine ol ON o.order_id = ol.order_id
JOIN 
    Products p ON ol.product_id = p.product_id
LEFT JOIN 
    ProductImages pi ON p.product_id = pi.product_id
LEFT JOIN 
    Colors c ON ol.color_id = c.color_id
JOIN 
    ProductCategoryMappings pcat ON p.product_id = pcat.product_id  -- Join to map products to categories
JOIN 
    Categories cat ON pcat.category_id = cat.category_id  -- Join to get category names
WHERE 
    o.user_id = ?
GROUP BY 
    o.order_id, ol.order_line_id
ORDER BY 
    o.order_id;
    `;
    const rows = await query(getOrdersQuery, [req.user.id])

    if (rows.length === 0) {
        return null; // No order found
    }
    const ordersMap = {};

    for(const row of rows) {
    const {
      order_id,
      user_id,
      invoice,
      creation_date,
      confirmation_date,
      shipping_date,
      delivered_date,
      product_id,
      images,
      name,
      quantity,
      price,
      shade_name,
      code,
      categories,
      order_status
    } = row;

    // If the order_id doesn't exist in the map, create a new order entry
    if (!ordersMap[order_id]) {
        ordersMap[order_id] = {
            order_id,
            user_id,
            invoice,
            creation_date,
            confirmation_date,
            shipping_date,
            delivered_date,
            products: [],
            status : order_status
        };
    }

    // Add product details to the corresponding order
    ordersMap[order_id].products.push({
        product_id,
        images: images ? images.split(',') : [],
        categories : categories ? categories.split(',') : [],
        name,
        quantity,
        price,
        shade_name,
        code
    });
    }

    res.status(200).json(Object.values(ordersMap));
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.get("/order/:id", verifyAuth, async(req, res) => {
  console.log("in get order")
  try {
    let db = await createConnection();

    const { id } = req.params;
    let query = util.promisify(db.query).bind(db); 
    const getOrdersQuery = `
SELECT 
    o.order_id,
    o.user_id,
    o.invoice,
    o.order_status,
    o.creation_date,
    o.confirmation_date,
    o.shipping_date,
    o.total,
    o.delivered_date,
    ol.product_id,
    GROUP_CONCAT(DISTINCT pi.image) AS images, 
    p.name,
    ol.quantity,
    p.price,
    c.shade_name,
    c.code,
    GROUP_CONCAT(DISTINCT cat.category_name) AS categories  -- Get distinct category names
FROM 
    Orders o
JOIN 
    OrderLine ol ON o.order_id = ol.order_id
JOIN 
    Products p ON ol.product_id = p.product_id
LEFT JOIN 
    ProductImages pi ON p.product_id = pi.product_id
LEFT JOIN 
    Colors c ON ol.color_id = c.color_id
JOIN 
    ProductCategoryMappings pcat ON p.product_id = pcat.product_id  -- Join to map products to categories
JOIN 
    Categories cat ON pcat.category_id = cat.category_id  -- Join to get category names
WHERE 
    o.order_id = ?
GROUP BY 
    o.order_id, ol.order_line_id
ORDER BY 
    o.order_id;
    `;
    const rows = await query(getOrdersQuery, [req.user.id])

    if (rows.length === 0) {
        return null; // No order found
    }
    const ordersMap = {};

    for(const row of rows) {
    const {
      order_id,
      user_id,
      invoice,
      creation_date,
      confirmation_date,
      shipping_date,
      delivered_date,
      product_id,
      images,
      total,
      name,
      quantity,
      price,
      shade_name,
      code,
      categories,
      order_status
    } = row;

    // If the order_id doesn't exist in the map, create a new order entry
    if (!ordersMap[order_id]) {
        ordersMap[order_id] = {
            order_id,
            user_id,
            invoice,
            creation_date,
            confirmation_date,
            shipping_date,
            delivered_date,
            products: [],
            status : order_status,
            total
        };
    }

    // Add product details to the corresponding order
    ordersMap[order_id].products.push({
        product_id,
        images: images ? images.split(',') : [],
        categories : categories ? categories.split(',') : [],
        name,
        quantity,
        price,
        shade_name,
        code
    });
    }
    console.log(ordersMap)
    res.status(200).json(Object.values(ordersMap));
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.post('/pay', verifyAuth,async (req, res) => { 
  let db = await createConnection();

  console.log("hi from /pay")
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: 'USD',
        value: req.body.amount,
      }
    }]
  });

  try {
    const order = await client.execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    res.status(500).send(err);
  }
});

app.post('/capture',verifyAuth, async (req, res) => { 
  let db = await createConnection();

  console.log("in capture =>", req.body)
  const { orderID } = req.body;
  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});

  try {
    const capture = await client.execute(request);
    res.json(capture.result);
  } catch (err) {
    res.status(500).send(err);
  }
});

app.post('/addreview', verifyAuth, async(req, res) => {
  const {product_id, review, rating} = req.body
  try {
    let db = await createConnection();

    const sql = 'INSERT INTO Reviews(user_id, product_id, review_content, review_stars) VALUES(?, ?, ?, ?)';
    db.query(sql, [req.user.id, product_id, review, rating], (err, result) => {
      if (err) {
        console.error('Error inserting review:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'added successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.get('/getreviews', verifyAuth, async(req, res) => {
  const {product_id} = req.body
  try {
    let db = await createConnection();

    const sql = 'SELECT * from Reviews WHERE product_id = ?';
    db.query(sql, [product_id], (err, result) => {
      if (err) {
        console.error('Error getting reviews', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json(result);
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.get("/admingetorders", verifyAdminAuth, async(req, res) => {
  try {
    let db = await createConnection();

    let query = util.promisify(db.query).bind(db); 
    const getOrdersQuery = `SELECT 
    o.order_id,
    o.user_id,
    o.invoice,
    o.order_status,
    o.creation_date,
    o.confirmation_date,
    o.shipping_date,
    o.delivered_date,
    ol.product_id,
    GROUP_CONCAT(DISTINCT pi.image) AS images, 
    p.name,
    ol.quantity,
    p.price,
    c.shade_name,
    c.code,
    GROUP_CONCAT(DISTINCT cat.category_name) AS categories,  -- Get distinct category names
    a.address_id,
    a.full_name,
    a.address_line1,
    a.address_line2,
    a.city,
    a.state,
    a.pincode,
    a.country,
    a.mobile
FROM 
    Orders o
JOIN 
    OrderLine ol ON o.order_id = ol.order_id
JOIN 
    Products p ON ol.product_id = p.product_id
LEFT JOIN 
    ProductImages pi ON p.product_id = pi.product_id
LEFT JOIN 
    Colors c ON ol.color_id = c.color_id
JOIN 
    ProductCategoryMappings pcat ON p.product_id = pcat.product_id  -- Join to map products to categories
JOIN 
    Categories cat ON pcat.category_id = cat.category_id  -- Join to get category names
LEFT JOIN 
    Address a ON o.address_id = a.address_id  -- Join with Address table
GROUP BY 
    o.order_id, ol.order_line_id
ORDER BY 
    o.order_id;
    `;
    const rows = await query(getOrdersQuery)

    if (rows.length === 0) {
        return null; // No order found
    }
    const ordersMap = {};

    for (const row of rows) {
      const {
        order_id,
        user_id,
        invoice,
        creation_date,
        confirmation_date,
        shipping_date,
        delivered_date,
        product_id,
        images,
        name,
        quantity,
        price,
        shade_name,
        code,
        categories,
        order_status,
        // Address fields
        address_id,
        full_name,
        address_line1,
        address_line2,
        city,
        state,
        pincode,
        country,
        mobile
      } = row;
  
      // If the order_id doesn't exist in the map, create a new order entry
      if (!ordersMap[order_id]) {
          ordersMap[order_id] = {
              order_id,
              user_id,
              invoice,
              creation_date,
              confirmation_date,
              shipping_date,
              delivered_date,
              products: [],
              status : order_status,
              address: {
                  address_id,
                  full_name,
                  address_line1,
                  address_line2,
                  city,
                  state,
                  pincode,
                  country,
                  mobile
              }
          };
      }
  
      // Add product details to the corresponding order
      ordersMap[order_id].products.push({
          product_id,
          images: images ? images.split(',') : [],
          categories : categories ? categories.split(',') : [],
          name,
          quantity,
          price,
          shade_name,
          code
      });
  }
  

    res.status(200).json(Object.values(ordersMap));
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.post('/adminconfirmorder', verifyAdminAuth, async(req, res) => {
  const {order_id} = req.body
  try {
    let db = await createConnection();

    const sql = 'UPDATE Orders SET order_status = "confirmed" WHERE order_id = ?';
    db.query(sql, [order_id], (err, result) => {
      if (err) {
        console.error('Error updating order:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'status changed successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.post('/adminshiporder', verifyAdminAuth, async(req, res) => {
  const {order_id} = req.body
  try {
    let db = await createConnection();

    const sql = 'UPDATE Orders SET order_status = "shipped" WHERE order_id = ?';
    db.query(sql, [order_id], (err, result) => {
      if (err) {
        console.error('Error updating order:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'status changed successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

app.post('/admindeliverorder', verifyAdminAuth, async(req, res) => {
  const {order_id} = req.body
  try {
    let db = await createConnection();

    const sql = 'UPDATE Orders SET order_status = "delivered" WHERE order_id = ?';
    db.query(sql, [order_id], (err, result) => {
      if (err) {
        console.error('Error updating order:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'status changed successfully!' });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Server error' });
  }
})

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
