/**
 * Email.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */
// @TODO: Refactor to CommonUtils in similie-api-services module
const Utils = require('../services/Utils');

module.exports = {
  attributes: {
    from: {
      type: 'json',
      required: true
    },

    to: {
      type: 'json',
      required: true
    },

    subject: {
      type: 'string'
    },

    body: {
      type: 'text'
    },

    attachments: {
      type: 'array'
    },

    // Data used in template
    data: {
      type: 'json'
    },

    // Template for this email
    template: {
      type: 'string',
      required: true
    },

    // Mandrill-specific tags (X-MC-Tags) for this email
    // http://help.mandrill.com/entries/21688056-Using-SMTP-Headers-to-customize-your-messages
    tags: {
      type: 'array',
      defaultsTo: ['transactional']
    },

    resolution: {
      type: 'text'
    },

    /**
     * Send email using mailer service
     */

    send: function(locals, data, cb, attachments) {
      const self = this;
      locals.data = data;

      Mailer.template(this.template, locals, (err, html, text) => {
        if (err) {
          return cb(err);
        }
        const message = {
          from: self.from, // self.from.name + ' <' + self.from.email + '>',
          subject: self.subject,
          attachments: attachments,
          html: html,
          text: text,
          to: self.to,
          headers: Email.getHeaders(self)
        };
        // // Attach tags
        // message.headers = Email.getHeaders();
        // Send mail
        Mailer.sendMail(message, (err, result) => {
          if (err) {
            return cb(err);
          }
          cb(null, result, message);
        });
      });
    },

    sendBasic: async function(locals = {}) {
      const email = this.toObject();
      const message = await Email.pullEmailMessage(
        email,
        Email.mergeEmailToLocals(email, locals)
      );
      return Email.sendMailAsync(message);
    }
  },

  sendMailAsync: function(message = {}) {
    return new Promise((resolve, reject) => {
      Mailer.sendMail(message, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      });
    });
  },

  mergeEmailToLocals: function(email = {}, locals = {}) {
    const sendLocals = {
      host: '',
      site_name: sails.config.mail.siteName,
      ...email,
      ...locals
      // data: {
      //   ...locals
      // }
    };
    return sendLocals;
  },

  getHeaders: function(email) {
    if (!email.tags) {
      return {};
    }
    return {
      'X-MC-Tags': email.tags.join()
    };
  },

  pullEmailMessage: async function(email = {}, locals = { data: {} }) {
    const template = await Email.pullEmailTemplate(email, locals);
    return {
      from: email.from,
      subject: email.subject,
      attachments: email.attachments || [],
      html: template.html,
      text: template.text,
      to: email.to,
      locals: locals,
      headers: Email.getHeaders(email)
    };
  },

  pullEmailTemplate: function(email = {}, locals = {}) {
    return new Promise((resolve, reject) => {
      Mailer.template(email.template, locals, (err, html, text) => {
        if (err) {
          return reject(err);
        }
        resolve({
          html,
          text
        });
      });
    });
  },

  findContactCredentials: async function(values) {
    if (!values.user) {
      return false;
    }

    const user = await User.findOneById(Model.getId(values.user));
    return {
      name: User.fullName(user),
      email: user.email,
      user: user,
      schema: UserSchema.getId(user.schema)
    };
  },

  fromDefault: function(name = '', from = null) {
    const fromParams = {
      name: name || sails.config.mail.from.name,
      address: (from && from.address) || sails.config.mail.from.email
    };
    return fromParams;
  },

  sendUserMessages: async function(
    message,
    subject,
    user,
    domain,
    attachments
  ) {
    if (user.type === 'user') {
      await Message.create({
        to: [User.getId(user)],
        send_email: true,
        subject: subject,
        body: message
      });
    } else {
      const from = await User.similieUser(domain);
      const config = await Site.thisSiteAsync((from || {}).last_domain);

      const name = User.fullName(user);
      const locals = {
        full_name: name,
        NAME: name,
        sender_name: User.fullName(from),
        host: Utils.pullHost(config),
        subject: subject,
        body: message,
        site_name: config.site_name
      };

      Jobs.sendEmail.add({
        to: {
          address: user.email,
          name: user.name
        },
        subject: subject,
        body: message,
        locals: locals,
        template: 'message',
        variables: Email.variables.message.key,
        attachments: attachments || [],
        tags: ['user message']
      });
    }
  },

  setUserComs: async function(values, emailElements, attachments) {
    const notificationVars = await Variable.find({
      key: emailElements.key
    });
    const varCache = {};
    _.each(notificationVars, v => {
      varCache[v.identity] = v.value;
    });

    const fileIds = _.pluck(attachments, 'id');

    const sendEmail = async (to, name, email, domain) => {
      const similieUser = await User.similieUser(domain);
      const config = await Site.thisSiteAsync(domain);
      const lang =
        to.preferred_language ||
        config.default_language ||
        Translates.fallbackLanguage;

      const locals = _.merge(
        {
          full_name: name,
          sender_name: User.fullName(similieUser),
          body: Utils.parseLocals(
            (varCache[emailElements.body] || {})[lang],
            values
          ),
          subject: Utils.parseLocals(
            (varCache[emailElements.subject] || {})[lang],
            values
          ),
          host: Utils.pullHost(config),
          site_name: config.site_name,
          ...values
        },
        to
      );

      Jobs.sendEmail.add({
        to: {
          address: email,
          name: name
        },
        subject: Utils.parseLocals(
          (varCache[emailElements.subject] || {})[lang],
          values
        ),
        locals: locals,
        language: to.preferred_language || config.default_language,
        template: 'message',
        variables: Email.variables.message.key,
        attachments: attachments,
        tags: ['user message']
      });
    };

    const contactCredentials = await Email.findContactCredentials(values);

    if (!contactCredentials || !contactCredentials.email) {
      return;
    }

    const user = contactCredentials.user;

    if (values.user_type === 'user') {
      const config = await Site.thisSiteAsync(user.last_domain);
      const lang =
        user.preferred_language ||
        config.default_language ||
        Translates.fallbackLanguage;
      const similieUser = await User.similieUser(user.last_domain);
      const locals = {
        full_name: User.fullName(user),
        sender_name: User.fullName(similieUser),
        body: Utils.parseLocals(
          (varCache[emailElements.body] || {})[lang],
          values
        ),
        subject: Utils.parseLocals(
          (varCache[emailElements.subject] || {})[lang],
          values
        ),
        host: Utils.pullHost(config),
        site_name: config.site_name,
        ...values
      };

      await Message.create({
        to: [User.getId(user)],
        send_email: true,
        subject: Utils.parseLocals(
          (varCache[emailElements.subject] || {})[lang],
          locals
        ),
        body: Utils.parseLocals(
          (varCache[emailElements.body] || {})[lang],
          locals
        ),
        files: fileIds
      });
    } else {
      sendEmail(
        user,
        contactCredentials.name,
        contactCredentials.email,
        user.domain
      );
    }
  },

  parseEmailVars: function(template, variables, language, cb) {
    const vars = (Email.variables[template] || {}).contents;
    const fallback = {};
    const variableContent = {};

    fallback[language] = 'Unknown Language Values';

    Variable.findOne({
      key: 'language_unknown',
      identity: 'default_message'
    }).exec((err, defaultMessage) => {
      const defaultLang = ((defaultMessage || {}).value || fallback)[language];
      findContents(variables, vars, variableContent, language, defaultLang);
      cb(err, variableContent);
    });
  },

  // walkValues: function(split, locals) {
  //   const key = split.shift();
  //   if (!_.size(split)) {
  //     return _.isObject(locals) ? locals[key] : null;
  //   } else {
  //     return this.walkValues(split, locals[key]);
  //   }
  // },

  parseLocals: function(stringValue, locals, nullify) {
    sails.log.debug(
      `Email.parselocals is deprecated, please use Utils.parseLocals`
    );

    return Utils.parseLocals(stringValue, locals, nullify);
  },

  // parseLocals: function(stringValue, locals, nullify) {
  //   ///\#[0-9a-fA-F]+?\'/gm
  //   const match = (stringValue || "").match(/\%(.[^\s]*?)\%/g); ////\%[0-9a-fA-F]+?\%/gm);
  //   if (!match || !match.length) {
  //     return stringValue;
  //   }

  //   _.each(match, m => {
  //     const key = m.replaceAll("%", "");
  //     let value;
  //     if (_.contains(key, ".")) {
  //       const split = key.split(".");
  //       value = this.walkValues(split, locals);
  //     } else {
  //       value = locals[key];
  //     }

  //     if (key === "<br/>") {
  //       stringValue = stringValue.replaceAll(m, "\n");
  //     } else {
  //       if (!_.isUndefined(value)) {
  //         let local;
  //         if (value == null) {
  //           local = nullify ? "NULL" : "UNKNOWN";
  //         } else {
  //           local = value;
  //         }
  //         stringValue = stringValue.replaceAll(m, local);
  //       } else if (nullify) {
  //         stringValue = stringValue.replaceAll(m, "NULL");
  //       }
  //     }
  //   });

  //   return stringValue;
  // },

  variables: {
    sp_initiation_collaborators: {
      key: 'survey_pool_initiation_collaborators',
      contents: {
        email_subject: 'email_subject',
        email_header: 'email_header',
        email_footer: 'email_footer',
        email_body: 'email_body',
        extras: {}
      },
      template: 'data'
    },

    sp_midway_collaborators: {
      key: 'survey_pool_midway_collaborators',
      contents: {
        email_subject: 'email_subject',
        email_header: 'email_header',
        email_footer: 'email_footer',
        email_body: 'email_body',
        extras: {}
      },
      template: 'data'
    },

    sp_expiration_collaborators: {
      key: 'survey_pool_expiration_collaborators',
      contents: {
        email_subject: 'email_subject',
        email_header: 'email_header',
        email_footer: 'email_footer',
        email_body: 'email_body',
        extras: {}
      },
      template: 'data'
    },

    sp_initiation: {
      key: 'survey_pool_initiation',
      contents: {
        email_subject: 'email_subject',
        email_header: 'email_header',
        email_footer: 'email_footer',
        email_body: 'email_body',
        extras: {}
      },
      template: 'data'
    },

    sp_midway: {
      key: 'survey_pool_midway',
      contents: {
        email_subject: 'email_subject',
        email_header: 'email_header',
        email_footer: 'email_footer',
        email_body: 'email_body',
        extras: {}
      },
      template: 'data'
    },

    sp_expiration: {
      key: 'survey_pool_expiration',
      contents: {
        email_subject: 'email_subject',
        email_header: 'email_header',
        email_footer: 'email_footer',
        email_body: 'email_body',
        extras: {}
      },
      template: 'data'
    },

    data: {
      key: 'contact_invite_email',
      contents: {
        email_subject: 'email_subject',
        email_header: 'email_header',
        email_footer: 'email_footer',
        email_body: 'email_body',
        extras: {}
      }
    },

    invite: {
      key: 'user_invite_email',
      contents: {
        email_subject: 'email_subject', // Welcome %NAME%. You have been invited to join %SITE_NAME%
        email_header: 'email_header', // Account Created
        email_footer: 'email_footer', // Click to Activate your Account
        email_body: 'email_body', // Your invitation token will expire in %DAYS%. Please activate your account before this time frame.
        extras: {}
      }
    },

    message: {
      key: 'user_message_email',
      contents: {
        // email_subject: 'email_subject',// not used
        email_header: 'message_email_header', // not used
        email_footer: 'message_email_footer', // This message was sent by %full_name% via %site_name%.
        extras: {}
      }
    },

    password: {
      key: 'pasword_reset_email',
      contents: {
        email_subject: 'email_subject', // %name%, you've requested to change your password
        email_header: 'email_header', //  Password Reset
        email_footer: 'email_footer', // Click to reset your password
        email_body: 'email_body', // Your reset token will expire in %days%. Please reset your password immediately.
        extras: {}
      }
    },

    device_tracker: {
      key: 'device_tracker_email',
      contents: {
        email_subject: 'email_subject', // %name%, your device communication report
        email_header: 'email_header', //  Devices that failed to report on %TODAY%
        email_footer: 'email_footer', //
        email_body: 'email_body', // %name%,<br/>the following devices failed to send data to %site_name%.
        extras: {}
      }
    },

    receipt: {
      key: 'pos_receipt_email',
      contents: {
        email_subject: 'email_subject', // %name%, your device communication report
        email_header: 'email_header', //  Devices that failed to report on %TODAY%
        email_footer: 'email_footer', //
        email_body: 'email_body',
        extras: {}
      }
    },

    ews: {
      key: 'early_warning_email',
      contents: {
        email_subject: 'email_subject', // %SITE% Early Warning for %STATION%
        email_header: 'email_header', // Early Warning
        email_footer: 'email_footer', //
        // Your reset token will expire in %days%. Please reset your password immediately.
        extras: {}
      }
    }
  },
  css: `@import url(https://use.typekit.net/eoy5bol.css);.wrapper{width:100%}#outlook a{padding:0}body{width:100%!important;min-width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;margin:0;Margin:0;padding:0;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;box-sizing:border-box}.ExternalClass{width:100%}.ExternalClass,.ExternalClass div,.ExternalClass font,.ExternalClass p,.ExternalClass span,.ExternalClass td,.ExternalClass th{line-height:100%}#backgroundTable{margin:0;Margin:0;padding:0;width:100%!important;line-height:100%!important}img{outline:0;text-decoration:none;-ms-interpolation-mode:bicubic;width:auto;max-width:100%;clear:both;display:block}center{width:100%;min-width:580px}a img{border:none}table{border-spacing:0;border-collapse:collapse}td,th{word-wrap:break-word;-webkit-hyphens:auto;-moz-hyphens:auto;hyphens:auto;border-collapse:collapse!important}table,td,th,tr{padding-top:0;padding-right:0;padding-bottom:0;padding-left:0;vertical-align:top;text-align:left}@media only screen{html{min-height:100%;background:#f3f3f3}}table.body{background:#f3f3f3;height:100%;width:100%}table.container{background:#fefefe;width:580px;margin:0 auto;Margin:0 auto;text-align:inherit}table.row{padding:0;width:100%;position:relative}table.spacer{width:100%}table.spacer td{mso-line-height-rule:exactly}table.container table.row{display:table}td.column,td.columns,th.column,th.columns{margin:0 auto;Margin:0 auto;padding-left:24px;padding-bottom:24px}td.column .column.first,td.column .columns.first,td.columns .column.first,td.columns .columns.first,th.column .column.first,th.column .columns.first,th.columns .column.first,th.columns .columns.first{padding-left:0!important}td.column .column.last,td.column .columns.last,td.columns .column.last,td.columns .columns.last,th.column .column.last,th.column .columns.last,th.columns .column.last,th.columns .columns.last{padding-right:0!important}td.column .column center,td.column .columns center,td.columns .column center,td.columns .columns center,th.column .column center,th.column .columns center,th.columns .column center,th.columns .columns center{min-width:none!important}td.column.last,td.columns.last,th.column.last,th.columns.last{padding-right:24px}td.column table,td.columns table,th.column table,th.columns table{width:100%}td.column table.button,td.columns table.button,th.column table.button,th.columns table.button{width:auto}td.column table.button.expand,td.column table.button.expanded,td.columns table.button.expand,td.columns table.button.expanded,th.column table.button.expand,th.column table.button.expanded,th.columns table.button.expand,th.columns table.button.expanded{width:100%}td.large-1,th.large-1{width:24.33333px;padding-left:12px;padding-right:12px}td.large-1.first,th.large-1.first{padding-left:24px}td.large-1.last,th.large-1.last{padding-right:24px}.collapse>tbody>tr>td.large-1,.collapse>tbody>tr>th.large-1{padding-right:0;padding-left:0;width:48.33333px}.collapse td.large-1.first,.collapse td.large-1.last,.collapse th.large-1.first,.collapse th.large-1.last{width:60.33333px}td.large-1 center,th.large-1 center{min-width:-23.66667px}.body .column td.large-1,.body .column th.large-1,.body .columns td.large-1,.body .columns th.large-1{width:8.33333%}td.large-2,th.large-2{width:72.66667px;padding-left:12px;padding-right:12px}td.large-2.first,th.large-2.first{padding-left:24px}td.large-2.last,th.large-2.last{padding-right:24px}.collapse>tbody>tr>td.large-2,.collapse>tbody>tr>th.large-2{padding-right:0;padding-left:0;width:96.66667px}.collapse td.large-2.first,.collapse td.large-2.last,.collapse th.large-2.first,.collapse th.large-2.last{width:108.66667px}td.large-2 center,th.large-2 center{min-width:24.66667px}.body .column td.large-2,.body .column th.large-2,.body .columns td.large-2,.body .columns th.large-2{width:16.66667%}td.large-3,th.large-3{width:121px;padding-left:12px;padding-right:12px}td.large-3.first,th.large-3.first{padding-left:24px}td.large-3.last,th.large-3.last{padding-right:24px}.collapse>tbody>tr>td.large-3,.collapse>tbody>tr>th.large-3{padding-right:0;padding-left:0;width:145px}.collapse td.large-3.first,.collapse td.large-3.last,.collapse th.large-3.first,.collapse th.large-3.last{width:157px}td.large-3 center,th.large-3 center{min-width:73px}.body .column td.large-3,.body .column th.large-3,.body .columns td.large-3,.body .columns th.large-3{width:25%}td.large-4,th.large-4{width:169.33333px;padding-left:12px;padding-right:12px}td.large-4.first,th.large-4.first{padding-left:24px}td.large-4.last,th.large-4.last{padding-right:24px}.collapse>tbody>tr>td.large-4,.collapse>tbody>tr>th.large-4{padding-right:0;padding-left:0;width:193.33333px}.collapse td.large-4.first,.collapse td.large-4.last,.collapse th.large-4.first,.collapse th.large-4.last{width:205.33333px}td.large-4 center,th.large-4 center{min-width:121.33333px}.body .column td.large-4,.body .column th.large-4,.body .columns td.large-4,.body .columns th.large-4{width:33.33333%}td.large-5,th.large-5{width:217.66667px;padding-left:12px;padding-right:12px}td.large-5.first,th.large-5.first{padding-left:24px}td.large-5.last,th.large-5.last{padding-right:24px}.collapse>tbody>tr>td.large-5,.collapse>tbody>tr>th.large-5{padding-right:0;padding-left:0;width:241.66667px}.collapse td.large-5.first,.collapse td.large-5.last,.collapse th.large-5.first,.collapse th.large-5.last{width:253.66667px}td.large-5 center,th.large-5 center{min-width:169.66667px}.body .column td.large-5,.body .column th.large-5,.body .columns td.large-5,.body .columns th.large-5{width:41.66667%}td.large-6,th.large-6{width:266px;padding-left:12px;padding-right:12px}td.large-6.first,th.large-6.first{padding-left:24px}td.large-6.last,th.large-6.last{padding-right:24px}.collapse>tbody>tr>td.large-6,.collapse>tbody>tr>th.large-6{padding-right:0;padding-left:0;width:290px}.collapse td.large-6.first,.collapse td.large-6.last,.collapse th.large-6.first,.collapse th.large-6.last{width:302px}td.large-6 center,th.large-6 center{min-width:218px}.body .column td.large-6,.body .column th.large-6,.body .columns td.large-6,.body .columns th.large-6{width:50%}td.large-7,th.large-7{width:314.33333px;padding-left:12px;padding-right:12px}td.large-7.first,th.large-7.first{padding-left:24px}td.large-7.last,th.large-7.last{padding-right:24px}.collapse>tbody>tr>td.large-7,.collapse>tbody>tr>th.large-7{padding-right:0;padding-left:0;width:338.33333px}.collapse td.large-7.first,.collapse td.large-7.last,.collapse th.large-7.first,.collapse th.large-7.last{width:350.33333px}td.large-7 center,th.large-7 center{min-width:266.33333px}.body .column td.large-7,.body .column th.large-7,.body .columns td.large-7,.body .columns th.large-7{width:58.33333%}td.large-8,th.large-8{width:362.66667px;padding-left:12px;padding-right:12px}td.large-8.first,th.large-8.first{padding-left:24px}td.large-8.last,th.large-8.last{padding-right:24px}.collapse>tbody>tr>td.large-8,.collapse>tbody>tr>th.large-8{padding-right:0;padding-left:0;width:386.66667px}.collapse td.large-8.first,.collapse td.large-8.last,.collapse th.large-8.first,.collapse th.large-8.last{width:398.66667px}td.large-8 center,th.large-8 center{min-width:314.66667px}.body .column td.large-8,.body .column th.large-8,.body .columns td.large-8,.body .columns th.large-8{width:66.66667%}td.large-9,th.large-9{width:411px;padding-left:12px;padding-right:12px}td.large-9.first,th.large-9.first{padding-left:24px}td.large-9.last,th.large-9.last{padding-right:24px}.collapse>tbody>tr>td.large-9,.collapse>tbody>tr>th.large-9{padding-right:0;padding-left:0;width:435px}.collapse td.large-9.first,.collapse td.large-9.last,.collapse th.large-9.first,.collapse th.large-9.last{width:447px}td.large-9 center,th.large-9 center{min-width:363px}.body .column td.large-9,.body .column th.large-9,.body .columns td.large-9,.body .columns th.large-9{width:75%}td.large-10,th.large-10{width:459.33333px;padding-left:12px;padding-right:12px}td.large-10.first,th.large-10.first{padding-left:24px}td.large-10.last,th.large-10.last{padding-right:24px}.collapse>tbody>tr>td.large-10,.collapse>tbody>tr>th.large-10{padding-right:0;padding-left:0;width:483.33333px}.collapse td.large-10.first,.collapse td.large-10.last,.collapse th.large-10.first,.collapse th.large-10.last{width:495.33333px}td.large-10 center,th.large-10 center{min-width:411.33333px}.body .column td.large-10,.body .column th.large-10,.body .columns td.large-10,.body .columns th.large-10{width:83.33333%}td.large-11,th.large-11{width:507.66667px;padding-left:12px;padding-right:12px}td.large-11.first,th.large-11.first{padding-left:24px}td.large-11.last,th.large-11.last{padding-right:24px}.collapse>tbody>tr>td.large-11,.collapse>tbody>tr>th.large-11{padding-right:0;padding-left:0;width:531.66667px}.collapse td.large-11.first,.collapse td.large-11.last,.collapse th.large-11.first,.collapse th.large-11.last{width:543.66667px}td.large-11 center,th.large-11 center{min-width:459.66667px}.body .column td.large-11,.body .column th.large-11,.body .columns td.large-11,.body .columns th.large-11{width:91.66667%}td.large-12,th.large-12{width:556px;padding-left:12px;padding-right:12px}td.large-12.first,th.large-12.first{padding-left:24px}td.large-12.last,th.large-12.last{padding-right:24px}.collapse>tbody>tr>td.large-12,.collapse>tbody>tr>th.large-12{padding-right:0;padding-left:0;width:580px}.collapse td.large-12.first,.collapse td.large-12.last,.collapse th.large-12.first,.collapse th.large-12.last{width:592px}td.large-12 center,th.large-12 center{min-width:508px}.body .column td.large-12,.body .column th.large-12,.body .columns td.large-12,.body .columns th.large-12{width:100%}td.large-offset-1,td.large-offset-1.first,td.large-offset-1.last,th.large-offset-1,th.large-offset-1.first,th.large-offset-1.last{padding-left:72.33333px}td.large-offset-2,td.large-offset-2.first,td.large-offset-2.last,th.large-offset-2,th.large-offset-2.first,th.large-offset-2.last{padding-left:120.66667px}td.large-offset-3,td.large-offset-3.first,td.large-offset-3.last,th.large-offset-3,th.large-offset-3.first,th.large-offset-3.last{padding-left:169px}td.large-offset-4,td.large-offset-4.first,td.large-offset-4.last,th.large-offset-4,th.large-offset-4.first,th.large-offset-4.last{padding-left:217.33333px}td.large-offset-5,td.large-offset-5.first,td.large-offset-5.last,th.large-offset-5,th.large-offset-5.first,th.large-offset-5.last{padding-left:265.66667px}td.large-offset-6,td.large-offset-6.first,td.large-offset-6.last,th.large-offset-6,th.large-offset-6.first,th.large-offset-6.last{padding-left:314px}td.large-offset-7,td.large-offset-7.first,td.large-offset-7.last,th.large-offset-7,th.large-offset-7.first,th.large-offset-7.last{padding-left:362.33333px}td.large-offset-8,td.large-offset-8.first,td.large-offset-8.last,th.large-offset-8,th.large-offset-8.first,th.large-offset-8.last{padding-left:410.66667px}td.large-offset-9,td.large-offset-9.first,td.large-offset-9.last,th.large-offset-9,th.large-offset-9.first,th.large-offset-9.last{padding-left:459px}td.large-offset-10,td.large-offset-10.first,td.large-offset-10.last,th.large-offset-10,th.large-offset-10.first,th.large-offset-10.last{padding-left:507.33333px}td.large-offset-11,td.large-offset-11.first,td.large-offset-11.last,th.large-offset-11,th.large-offset-11.first,th.large-offset-11.last{padding-left:555.66667px}td.expander,th.expander{visibility:hidden;width:0;padding:0!important}table.container.radius{border-radius:0;border-collapse:separate}.block-grid{width:100%;max-width:580px}.block-grid td{display:inline-block;padding:12px}.up-2 td{width:266px!important}.up-3 td{width:169px!important}.up-4 td{width:121px!important}.up-5 td{width:92px!important}.up-6 td{width:72px!important}.up-7 td{width:58px!important}.up-8 td{width:48px!important}h1.text-center,h2.text-center,h3.text-center,h4.text-center,h5.text-center,h6.text-center,p.text-center,span.text-center,table.text-center,td.text-center,th.text-center{text-align:center}h1.text-left,h2.text-left,h3.text-left,h4.text-left,h5.text-left,h6.text-left,p.text-left,span.text-left,table.text-left,td.text-left,th.text-left{text-align:left}h1.text-right,h2.text-right,h3.text-right,h4.text-right,h5.text-right,h6.text-right,p.text-right,span.text-right,table.text-right,td.text-right,th.text-right{text-align:right}span.text-center{display:block;width:100%;text-align:center}@media only screen and (max-width:604px){.small-float-center{margin:0 auto!important;float:none!important;text-align:center!important}.small-text-center{text-align:center!important}.small-text-left{text-align:left!important}.small-text-right{text-align:right!important}}img.float-left{float:left;text-align:left}img.float-right{float:right;text-align:right}img.float-center,img.text-center{margin:0 auto;Margin:0 auto;float:none;text-align:center}table.float-center,td.float-center,th.float-center{margin:0 auto;Margin:0 auto;float:none;text-align:center}.hide-for-large{display:none;mso-hide:all;overflow:hidden;max-height:0;font-size:0;width:0;line-height:0}@media only screen and (max-width:604px){.hide-for-large{display:block!important;width:auto!important;overflow:visible!important;max-height:none!important;font-size:inherit!important;line-height:inherit!important}}table.body table.container .hide-for-large *{mso-hide:all}@media only screen and (max-width:604px){table.body table.container .hide-for-large,table.body table.container .row.hide-for-large{display:table!important;width:100%!important}}@media only screen and (max-width:604px){table.body table.container .callout-inner.hide-for-large{display:table-cell!important;width:100%!important}}@media only screen and (max-width:604px){table.body table.container .show-for-large{display:none!important;width:0;mso-hide:all;overflow:hidden}}body,h1,h2,h3,h4,h5,h6,p,table.body,td,th{color:#343434;font-family:Proxima Nova,sans-serif;font-weight:400;padding-top:0;padding-right:0;padding-bottom:0;padding-left:0;margin:0;Margin:0;text-align:left;line-height:1.4}h1,h2,h3,h4,h5,h6{color:inherit;word-wrap:normal;font-family:Proxima Nova,sans-serif;font-weight:700;margin-bottom:12px;Margin-bottom:12px}h1{font-size:36px}h2{font-size:30px}h3{font-size:24px}h4{font-size:18px}h5{font-size:14px}h6{font-size:12px}body,p,table.body,td,th{font-size:14px;line-height:1.4}p{margin-bottom:8px;Margin-bottom:8px}p.lead{font-size:17.5px;line-height:1.6}p.subheader{margin-top:4px;margin-bottom:8px;Margin-top:4px;Margin-bottom:8px;font-weight:400;line-height:1.4;color:#8a8a8a}small .small{font-size:80%;color:#343434}a{color:#06c4de;text-decoration:none;font-family:Proxima Nova,sans-serif;font-weight:400;padding:0;text-align:left;line-height:1.4}a:hover{color:#0598ac}a:active{color:#0598ac}a:visited{color:#06c4de}h1 a,h1 a:visited,h2 a,h2 a:visited,h3 a,h3 a:visited,h4 a,h4 a:visited,h5 a,h5 a:visited,h6 a,h6 a:visited{color:#06c4de}pre{background:#f3f3f3;margin:30px 0;Margin:30px 0}pre code{color:#cacaca}pre code span.callout{color:#8a8a8a;font-weight:700}pre code span.callout-strong{color:#ff6908;font-weight:700}td.column table.h-line table,td.column table.hr table,td.columns table.h-line table,td.columns table.hr table,th.column table.h-line table,th.column table.hr table,th.columns table.h-line table,th.columns table.hr table{width:auto}table.h-line th,table.hr th{padding-bottom:20px;text-align:center}table.h-line table,table.hr table{display:inline-block;margin:0;Margin:0}table.h-line td,table.hr td{width:580px;height:0;padding-top:20px;clear:both;border-top:0;border-right:0;border-bottom:#f9f9f9;border-left:0;font-size:0;line-height:0}.stat{font-size:40px;line-height:1}p+.stat{margin-top:-16px;Margin-top:-16px}span.preheader{display:none!important;visibility:hidden;mso-hide:all!important;font-size:1px;color:#f3f3f3;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden}@media only screen{a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}}table.button{width:auto;margin:0 0 24px 0;Margin:0 0 24px 0}table.button table td{text-align:left;color:#fefefe;background:#06c4de;border:2px solid #06c4de}table.button table td a{font-family:Proxima Nova,sans-serif;font-size:16px;font-weight:500;color:#fefefe;text-decoration:none;text-align:left;display:inline-block;padding:8px 24px 8px 24px;border:0 solid #06c4de;border-radius:8px}table.button.radius table td{border-radius:8px;border:none}table.button.rounded table td{border-radius:500px;border:none}table.button table tr td a:visited,table.button.large table tr td a:visited,table.button.large:active table tr td a,table.button.large:hover table tr td a,table.button.small table tr td a:visited,table.button.small:active table tr td a,table.button.small:hover table tr td a,table.button.tiny table tr td a:visited,table.button.tiny:active table tr td a,table.button.tiny:hover table tr td a,table.button:active table tr td a,table.button:hover table tr td a{color:#fefefe}table.button.tiny table a,table.button.tiny table td{padding:4px 8px 4px 8px}table.button.tiny table a{font-size:12px;font-weight:400}table.button.small table a,table.button.small table td{padding:5px 10px 5px 10px;font-size:14px}table.button.large table a{padding:10px 20px 10px 20px;font-size:16px}table.button.expand,table.button.expanded{width:100%}table.button.expand table,table.button.expanded table{width:100%}table.button.expand table a,table.button.expanded table a{text-align:center;width:100%;padding-left:0;padding-right:0}table.button.expand center,table.button.expanded center{min-width:0}table.button:active table td,table.button:hover table td,table.button:visited table td{background:#0598ac;color:#fefefe}table.button:active table a,table.button:hover table a,table.button:visited table a{border:0 solid #0598ac}table.button.secondary table td{background:#003245;color:#fefefe;border:0 solid #003245}table.button.secondary table a{color:#fefefe;border:0 solid #003245}table.button.secondary:hover table td{background:#005778;color:#fefefe}table.button.secondary:hover table a{border:0 solid #005778}table.button.secondary:hover table td a{color:#fefefe}table.button.secondary:active table td a{color:#fefefe}table.button.secondary table td a:visited{color:#fefefe}table.button.success table td{background:#39d094;border:0 solid #39d094}table.button.success table a{border:0 solid #39d094}table.button.success:hover table td{background:#29ad79}table.button.success:hover table a{border:0 solid #29ad79}table.button.alert table td{background:#e24c4c;border:0 solid #e24c4c}table.button.alert table a{border:0 solid #e24c4c}table.button.alert:hover table td{background:#d82323}table.button.alert:hover table a{border:0 solid #d82323}table.button.warning table td{background:#ffaa31;border:0 solid #ffaa31}table.button.warning table a{border:0 solid #ffaa31}table.button.warning:hover table td{background:#fd9500}table.button.warning:hover table a{border:0 solid #fd9500}table.callout{margin-bottom:24px;Margin-bottom:24px}th.callout-inner{width:100%;border:1px solid #06c4de;padding:10px;background:#06c4de}th.callout-inner.primary{background:#06c4de;border:1px solid #036c7b;color:#0a0a0a}th.callout-inner.secondary{background:#003245;border:1px solid #003245;color:#0a0a0a}th.callout-inner.success{background:#39d094;border:1px solid #39d094;color:#0a0a0a}th.callout-inner.warning{background:#ffaa31;border:1px solid #ffaa31;color:#0a0a0a}th.callout-inner.alert{background:#e24c4c;border:1px solid #e24c4c;color:#0a0a0a}.thumbnail{border:solid 4px #fefefe;box-shadow:0 0 0 1px rgba(10,10,10,.2);display:inline-block;line-height:0;max-width:100%;transition:box-shadow .2s ease-out;border-radius:8px;margin-bottom:24px}.thumbnail:focus,.thumbnail:hover{box-shadow:0 0 6px 1px rgba(6,196,222,.5)}table.menu{width:580px}table.menu td.menu-item,table.menu th.menu-item{padding:10px;padding-right:10px}table.menu td.menu-item a,table.menu th.menu-item a{color:#06c4de}table.menu.vertical td.menu-item,table.menu.vertical th.menu-item{padding:10px;padding-right:0;display:block}table.menu.vertical td.menu-item a,table.menu.vertical th.menu-item a{width:100%}table.menu.vertical td.menu-item table.menu.vertical td.menu-item,table.menu.vertical td.menu-item table.menu.vertical th.menu-item,table.menu.vertical th.menu-item table.menu.vertical td.menu-item,table.menu.vertical th.menu-item table.menu.vertical th.menu-item{padding-left:10px}table.menu.text-center a{text-align:center}.menu[align=center]{width:auto}.menu:not(.float-center) .menu-item:first-child{padding-left:0!important}.menu:not(.float-center) .menu-item:last-child{padding-right:0!important}.menu.vertical .menu-item{padding-left:0!important;padding-right:0!important}@media only screen and (max-width:604px){.menu.small-vertical .menu-item{padding-left:0!important;padding-right:0!important}}body.outlook p{display:inline!important}@media only screen and (max-width:604px){table.body img{width:auto;height:auto}table.body center{min-width:0!important}table.body .container{width:95%!important}table.body .column,table.body .columns{height:auto!important;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;box-sizing:border-box;padding-left:24px!important;padding-right:24px!important}table.body .column .column,table.body .column .columns,table.body .columns .column,table.body .columns .columns{padding-left:0!important;padding-right:0!important}table.body .collapse .column,table.body .collapse .columns{padding-left:0!important;padding-right:0!important}td.small-1,th.small-1{display:inline-block!important;width:8.33333%!important}td.small-2,th.small-2{display:inline-block!important;width:16.66667%!important}td.small-3,th.small-3{display:inline-block!important;width:25%!important}td.small-4,th.small-4{display:inline-block!important;width:33.33333%!important}td.small-5,th.small-5{display:inline-block!important;width:41.66667%!important}td.small-6,th.small-6{display:inline-block!important;width:50%!important}td.small-7,th.small-7{display:inline-block!important;width:58.33333%!important}td.small-8,th.small-8{display:inline-block!important;width:66.66667%!important}td.small-9,th.small-9{display:inline-block!important;width:75%!important}td.small-10,th.small-10{display:inline-block!important;width:83.33333%!important}td.small-11,th.small-11{display:inline-block!important;width:91.66667%!important}td.small-12,th.small-12{display:inline-block!important;width:100%!important}.column td.small-12,.column th.small-12,.columns td.small-12,.columns th.small-12{display:block!important;width:100%!important}table.body td.small-offset-1,table.body th.small-offset-1{margin-left:8.33333%!important;Margin-left:8.33333%!important}table.body td.small-offset-2,table.body th.small-offset-2{margin-left:16.66667%!important;Margin-left:16.66667%!important}table.body td.small-offset-3,table.body th.small-offset-3{margin-left:25%!important;Margin-left:25%!important}table.body td.small-offset-4,table.body th.small-offset-4{margin-left:33.33333%!important;Margin-left:33.33333%!important}table.body td.small-offset-5,table.body th.small-offset-5{margin-left:41.66667%!important;Margin-left:41.66667%!important}table.body td.small-offset-6,table.body th.small-offset-6{margin-left:50%!important;Margin-left:50%!important}table.body td.small-offset-7,table.body th.small-offset-7{margin-left:58.33333%!important;Margin-left:58.33333%!important}table.body td.small-offset-8,table.body th.small-offset-8{margin-left:66.66667%!important;Margin-left:66.66667%!important}table.body td.small-offset-9,table.body th.small-offset-9{margin-left:75%!important;Margin-left:75%!important}table.body td.small-offset-10,table.body th.small-offset-10{margin-left:83.33333%!important;Margin-left:83.33333%!important}table.body td.small-offset-11,table.body th.small-offset-11{margin-left:91.66667%!important;Margin-left:91.66667%!important}table.body table.columns td.expander,table.body table.columns th.expander{display:none!important}table.body .right-text-pad,table.body .text-pad-right{padding-left:10px!important}table.body .left-text-pad,table.body .text-pad-left{padding-right:10px!important}table.menu{width:100%!important}table.menu td,table.menu th{width:auto!important;display:inline-block!important}table.menu.small-vertical td,table.menu.small-vertical th,table.menu.vertical td,table.menu.vertical th{display:block!important}table.menu[align=center]{width:auto!important}table.button.small-expand,table.button.small-expanded{width:100%!important}table.button.small-expand table,table.button.small-expanded table{width:100%}table.button.small-expand table a,table.button.small-expanded table a{text-align:center!important;width:100%!important;padding-left:0!important;padding-right:0!important}table.button.small-expand center,table.button.small-expanded center{min-width:0}}.container.header{background:#f3f3f3}.body-drip{border-top:8px solid #639}.header{background:#003245;padding: 0 0 20px 0}.header img{height:64px}.sitename{padding-top:24px}.header .columns{padding-bottom:0}.header h4{color:#f7f7f7}.header .container{background:0 0;margin:0}.footer .columns{padding-bottom:0}.footer .wrapper-inner{padding:0 20px 20px 20px}.footer .container{background:0 0;border-top:solid 1px #dedede}.footer p{padding-top:8px}.subheading h4{color:#f9f9f9;margin-bottom:0}hr{margin-bottom:16px;background-color:#dedede;height:1px;border:none}th{font-weight:700}h1,h2,h3,h4,h5,h6{font-weight:700}.socialicons{height:11px;display:inline-block}`
};

function findContents(variables, vars, variableContent, language, defaultLang) {
  _.each(vars, (value, key) => {
    // emailVars[variable.identity] =
    if (!_.isArray(value) && _.isObject(value)) {
      findContents(variables, value, variableContent, language, defaultLang);
    } else {
      const found = _.where(variables, {
        identity: key
      });
      variableContent[key] =
        ((found[0] || {}).value || {})[language] || defaultLang;
    }
  });
}
