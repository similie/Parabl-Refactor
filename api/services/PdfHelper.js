const { CommonUtils } = require('similie-api-services');

const SkipperAdapter = sails.config.skipper.adapter;
const fileAdapter = SkipperAdapter(sails.config.skipper);

const fonts = {
  Roboto: {
    normal: 'node_modules/similie-styles/src/fonts/Roboto/Roboto-Regular.ttf',
    bold: 'node_modules/similie-styles/src/fonts/Roboto/Roboto-Medium.ttf',
    italics: 'node_modules/similie-styles/src/fonts/Roboto/Roboto-Italic.ttf',
    bolditalics:
      'node_modules/similie-styles/src/fonts/Roboto/Roboto-MediumItalic.ttf'
  }
};

const generateImageBase64 = async src => {
  let image = '';

  if (!src) return image;

  const isLocalFile = _.contains(src, 'api/v1/sysfiles/download/');
  try {
    if (isLocalFile) {
      const path = src.split(/[?#]/)[0];
      const pth = path.split('api/v1/sysfiles/download/');
      const id = pth[1] || 0;

      const file = await SysFile.findOneById(id);

      image = await new Promise(resolve =>
        fileAdapter.read(file.fd, (err, buffer) => {
          if (err) {
            sails.log.error(err);
            return resolve('');
          }
          const readableStream = buffer.toString('base64');
          resolve(readableStream);
        })
      );
    } else {
      image = await CommonUtils.imaging.encodeImage(src);
    }
  } catch (e) {
    sails.log.error('ERROR::generateImageBase64', e);
    image = '';
  }

  return image
    ? CommonUtils.imaging.ensureBase64EncodedImageHeader(image, '*.jpeg')
    : '';
};

module.exports = {
  fonts,
  generateImageBase64
};
