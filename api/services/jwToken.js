/**
 * jwToken
 *
 * @description :: JSON Webtoken Service for sails
 * @help        :: See https://github.com/auth0/node-jsonwebtoken & http://sailsjs.org/#!/documentation/concepts/Services
 */

const jwt = require('jsonwebtoken');
const tokenSecret = sails.config.session.secret;

// Generates a token from supplied payload
module.exports.issue = function(payload, expires) {
  return jwt.sign(
    payload,
    tokenSecret, // Token Secret that we sign it with
    {
      expiresIn: expires || sails.config.session.ttl // Token Expire time
    }
  );
};

// Verifies token on a request
module.exports.verify = function(token, callback) {
  return jwt.verify(
    token, // The token to be verified
    tokenSecret, // Same token we used to sign
    {}, // No Option, for more see https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback
    callback // Pass errors or decoded token to callback
  );
};

module.exports.decode = function(token) {
  return jwt.decode(token, { complete: true });
};

// Verifies token on a request
// module.exports.sign = function(token, callback) {
//   return jwt.verify(
//     token, // The token to be verified
//     tokenSecret, // Same token we used to sign
//     {}, // No Option, for more see https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback
//     callback //Pass errors or decoded token to callback
//   );
// };
