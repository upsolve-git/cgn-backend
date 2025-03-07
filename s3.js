const {s3} = require('./config.js');
const fs = require('fs');


function saveFiletoBucket(file, product_id, id) {
  return new Promise((resolve, reject) => {
    // Read file from the local filesystem
    fs.readFile(file.path, (err, data) => {
      if (err) {
        console.log(err);
        return reject(err);  // Reject the promise on error
      }

      // Set up S3 upload parameters
      const params = {
        Bucket: 'cgnproductuploads',
        Key: "product/" + String(product_id) + "/" + String(id) + ".png",
        Body: data
      };

      // Upload the file to S3
      s3.upload(params, (err, uploadData) => {
        if (err) {
          console.log(err);
          return reject(err);  // Reject the promise on error
        }

        console.log("file path = ", file.path);

        // Delete the file from the local filesystem after upload
        fs.unlink(file.path, (err) => {
          if (err) {
            console.log(err);
          } else {
            console.log("File successfully deleted from local storage.");
          }
        });

        console.log("successfully saved to s3");
        resolve(uploadData.Location);  // Resolve the promise with the S3 file location
      });
    });
  });
}
function updateFiletoBucket(file, product_id, id) {
  return new Promise((resolve, reject) => {
    // Read file from the local filesystem
    fs.readFile(file.path, (err, data) => {
      if (err) {
        console.log(err);
        return reject(err);  // Reject the promise on error
      }

      // Set up S3 upload parameters
      const params = {
        Bucket: 'cgnproductuploads',
        Key: file.originalname,
        Body: data
      };

      // Upload the file to S3
      s3.upload(params, (err, uploadData) => {
        if (err) {
          console.log(err);
          return reject(err);  // Reject the promise on error
        }

        console.log("file path = ", file.path);

        // Delete the file from the local filesystem after upload
        fs.unlink(file.path, (err) => {
          if (err) {
            console.log(err);
          } else {
            console.log("File successfully deleted from local storage.");
          }
        });

        console.log("successfully saved to s3");
        resolve(uploadData.Location);  // Resolve the promise with the S3 file location
      });
    });
  });
}

module.exports = {
  saveFiletoBucket,
  updateFiletoBucket
}

