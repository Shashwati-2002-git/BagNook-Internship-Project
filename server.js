const express = require('express');
const sql = require('mssql');
const path = require('path');
const multer = require('multer');

const app = express();
const port = 3000;

// Configure storage path and filename for uploaded files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'images'));
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage: storage });

// SQL Server configuration
const config = {
  user: 'sa',
  password: '78792002CBb#',
  server: 'localhost',
  database: 'bagnookDB',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};


// Serve static files (HTML, CSS, JS, images)
app.use(express.static(path.join(__dirname)));

//Connect to the database
async function connectDB() {
  try {
    const pool = await sql.connect(config);
    console.log('✅ Connected to SQL Server');
    return pool;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    throw err;
  }
}

app.use(express.urlencoded({ extended: true }));

// GET endpoint for retrieving products
app.get('/api/products', async (req, res) => {
  const typeId = req.query.typeId;
  try {
    const db = await connectDB();
    const result = await db
      .request()
      .input('typeId', sql.Int, typeId)
      .query(`
        SELECT Product_Name, Product_Desc, Material, Price, ImagePath
        FROM products
        WHERE PT_ID = @typeId
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Error fetching products:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  const keyword = req.query.q;

  if (!keyword || keyword.trim() === '') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    const db = await connectDB();
    const request = db.request();
    request.input('keyword', sql.NVarChar, `%${keyword}%`);

    const result = await request.query(`
      SELECT p.Product_Name, p.Product_Desc, p.Material, p.Price, p.ImagePath
      FROM products p
      INNER JOIN productTypes pt ON p.PT_ID = pt.PT_ID
      WHERE p.Product_Name LIKE @keyword
         OR p.Product_Desc LIKE @keyword
         OR p.Material LIKE @keyword
         OR pt.P_Type LIKE @keyword
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Search error:", err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.post('/api/upload-product', upload.single('ImageFile'), async (req, res) => {
  try {
    const db = await connectDB();

    const { PT_ID, Product_Name, Product_Desc, Material, Price } = req.body;
    const imagePath = req.file.filename;

    await db.request()
      .input('PT_ID', sql.Int, PT_ID)
      .input('Product_Name', sql.NVarChar, Product_Name)
      .input('Product_Desc', sql.NVarChar, Product_Desc)
      .input('Material', sql.NVarChar, Material)
      .input('Price', sql.Float, Price)
      .input('ImagePath', sql.NVarChar, imagePath)
      .query(`
        INSERT INTO products (PT_ID, Product_Name, Product_Desc, Material, Price, ImagePath)
        VALUES (@PT_ID, @Product_Name, @Product_Desc, @Material, @Price, @ImagePath)
      `);

    res.json({ message: 'Product uploaded successfully' });
  } catch (err) {
    console.error('❌ Upload failed:', err.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.use(express.json()); // For parsing JSON in DELETE requests

app.delete('/api/delete-product', async (req, res) => {
  try {
    const db = await connectDB();

    const { Product_Name, PT_ID } = req.body;

    const result = await db.request()
      .input('Product_Name', sql.NVarChar, Product_Name)
      .input('PT_ID', sql.Int, PT_ID)
      .query(`
        DELETE FROM products 
        WHERE Product_Name = @Product_Name AND PT_ID = @PT_ID
      `);

    if (result.rowsAffected[0] === 0) {
      res.status(404).json({ error: 'Product not found or already deleted' });
    } else {
      res.json({ message: 'Product deleted successfully' });
    }
  } catch (err) {
    console.error('❌ Delete failed:', err.message);
    res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
});

app.post('/api/update-product', upload.single('ImageFile'), async (req, res) => {
  try {
    const db = await connectDB();

    const { PT_ID, oldName } = req.body;
    const fieldsToUpdate = {};
    const request = db.request();

    // Required for WHERE clause
    request.input('PT_ID', sql.Int, PT_ID);
    request.input('oldName', sql.NVarChar, oldName);

    // Dynamically build SET clause
    if (req.body.Product_Name && req.body.Product_Name.trim() !== '') {
      fieldsToUpdate.Product_Name = req.body.Product_Name;
      request.input('Product_Name', sql.NVarChar, req.body.Product_Name);
    }

    if (req.body.Product_Desc && req.body.Product_Desc.trim() !== '') {
      fieldsToUpdate.Product_Desc = req.body.Product_Desc;
      request.input('Product_Desc', sql.NVarChar, req.body.Product_Desc);
    }

    if (req.body.Material && req.body.Material.trim() !== '') {
      fieldsToUpdate.Material = req.body.Material;
      request.input('Material', sql.NVarChar, req.body.Material);
    }

    if (req.body.Price && !isNaN(req.body.Price)) {
      fieldsToUpdate.Price = parseFloat(req.body.Price);
      request.input('Price', sql.Float, parseFloat(req.body.Price));
    }

    if (req.file) {
      fieldsToUpdate.ImagePath = req.file.filename;
      request.input('ImagePath', sql.NVarChar, req.file.filename);
    }

    // If no fields to update
    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    // Build SET clause
    const setClause = Object.keys(fieldsToUpdate)
      .map(field => `${field} = @${field}`)
      .join(', ');

    const query = `
      UPDATE products
      SET ${setClause}
      WHERE PT_ID = @PT_ID AND Product_Name = @oldName
    `;

    const result = await request.query(query);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Product not found or not updated' });
    }

    res.json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error('❌ Update failed:', err.message);
    res.status(500).json({ error: 'Update failed: ' + err.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});