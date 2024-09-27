const mysql = require('mysql2');

function createConnection() {
  return new Promise((resolve, reject) => {
    const db = mysql.createConnection({
      host: 'cgndbinstance.ctecww4uw29g.us-east-1.rds.amazonaws.com',
      user: 'root',
      password: 'CGN_db2024',
      database: 'cgnDB'
    });

    db.connect((err) => {
      if (err) {
        return reject(err);
      }
      console.log('Connected to MySQL database.');
      resolve(db);
    });
  });
}

module.exports = createConnection;