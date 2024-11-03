const axios = require('axios');
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;
const Particle = require('particle-api-js');
const particleAPI = new Particle();
let TOKEN = '';

const config = {
  host: 'https://api.particle.io',
  version: 'v1'
};

const getConfig = async res => {
  const config = await Site.thisSiteAsync(res.locals.domain);
  const integrations = config.integrations;

  return {
    username: integrations.particle_user,
    password: integrations.particle_pass
  };
};

const getToken = async res => {
  const { username, password } = await getConfig(res);

  if (TOKEN) return;

  TOKEN = await new Promise(resolve =>
    particleAPI.login({ username, password }).then(
      data => {
        resolve(data.body.access_token);
      },
      error => {
        sails.log.error('token error ', error);
        resolve('');
      }
    )
  );
};

const getDeviceDetail = async (res, deviceId) => {
  const { host, version } = config;

  await getToken(res);

  if (!TOKEN) {
    return { error: 'Token not found' };
  }

  try {
    const data = await axios(
      `${host}/${version}/devices/${deviceId}?access_token=${TOKEN}`
    ).then(({ data }) => data);

    if (!data) {
      return { error: true };
    }

    return { data };
  } catch (error) {
    return { error };
  }
};

const getDeviceDiagnostic = async (res, deviceId) => {
  const { host, version } = config;

  await getToken(res);

  if (!TOKEN) {
    return { error: 'Token not found' };
  }

  try {
    const data = await axios(
      `${host}/${version}/diagnostics/${deviceId}/last?access_token=${TOKEN}`
    ).then(({ data }) => data);

    if (!data.diagnostics) {
      return { error: true };
    }

    return { data };
  } catch (error) {
    return { error };
  }
};

const callFunction = async (res, params) => {
  const { id, deviceId, name, argument } = params;

  await getToken(res);

  if (!TOKEN) {
    return { error: 'Token not found' };
  }

  const data = await new Promise(resolve =>
    particleAPI.callFunction({ deviceId, name, argument, auth: TOKEN }).then(
      data => {
        sails.sockets.blast(`realtime-device-creation-${id}`, {
          id,
          source: name,
          data: data.body,
          time: TimeUtils.isoFormattedDate(now_)
        });

        resolve({ data: data.body });
      },
      error => {
        resolve({ error: true, message: error });
      }
    )
  );

  return data;
};

module.exports = {
  getDeviceDiagnostic,
  getDeviceDetail,
  callFunction
};
