const AWS = require('aws-sdk')

AWS.config.update({
    region : "ap-south-1",
    accessKeyId : 'AKIAXYKJUWLKGY37GEHC',
    secretAccessKey : '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'
})
const s3 = new AWS.S3()

module.exports = {
    s3,
}
