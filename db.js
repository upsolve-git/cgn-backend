const mysql = require('mysql2');

function createConnection() {
  return new Promise((resolve, reject) => {
    const db = mysql.createConnection({
      host: 'cgndbfree1.cf08ueq80ake.ap-south-1.rds.amazonaws.com',
      user: 'root',
      password: 'CGNbackendFree1',
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