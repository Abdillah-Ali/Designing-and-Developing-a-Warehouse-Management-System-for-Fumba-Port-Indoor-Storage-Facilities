const bcrypt = require("bcryptjs");

const hashPassword = async (password, client) => {
  return bcrypt.hash(password, 12);
};

const verifyPassword = async (password, hash, client) => {
  if (!password || !hash) return false;
  
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    return false;
  }
};

module.exports = {
  hashPassword,
  verifyPassword
};
