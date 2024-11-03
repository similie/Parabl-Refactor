module.exports = {
  DEFAULT_CURRENCY: 'USD',
  NULL: null,
  STRING_ONLY: true,
  WITHOUT_GEO: true,
  DONT_ROUND: false,
  ROUND: true,
  ADMIN_TOKEN_GENERATION: 7,
  USER_TOKEN_GENERATION: 2,
  sockets: {
    FORCE_LOGOUT: 'force_logout',
    NEW_MESSAGE: 'new_message',
    NEW_TASK_UPDATE: 'new_task_update',
    SESSION_EXPIRED: 'expired_user_session',
    EXCEL_REPORT_COMPILED: 'excel_report_compiled'
  },
  rules: {
    REJECT: -1,
    IRRELEVANT: 0,
    ACCEPTED: 1
  },
  timers: {
    MINUTE: 'minute',
    FIVE_MINUTE: '5 minute',
    THIRTY_MINUTE: '30 minute',
    HOUR: 'hour',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    CUSTOM: (interval, timer) => {
      return `${interval} ${timer}`;
    }
  },
  currencies: {
    USD: {
      symbol: '$',
      key: 'USD'
    }
  },
  code: {
    BAD_REQUEST: 400,
    FORBIDDEN: 403,
    SERVER_ERROR: 500
  },
  err: {
    UNKOWN_TYPE: 'errors.UNKNOW_TYPE',
    NO_USER_RECORD_FOUND: 'labels.NO_USER_RECORD',
    NO_STATION_RECORD_FOUND: 'labels.NO_STATION_RECORD',
    ORGANIZATIONAL_CAREER_ID_REQUIRED:
      'An organizational career ID is required to process this request',
    ORGNIZATION_HAS_NO_ASSIGNED_CAREER_PROGRESSION:
      'This organization has not been assinged a career progression',
    USER_MUST_BE_ASSIGNED_ORGANIZATION:
      'This user entity must be assigned and organization',
    ID_PARAM_NOT_PROVIDED: 'This Route Requires an ID parameter',
    REQUIRED_PARAMETERS_NOT_SUPPLIED: 'errors.REQUIRED_PARAMETERS_NOT_SUPPLIED',
    NON_MEMBERS_NOT_ALLOWED: 'errors.NON_MEMBERS_NOT_ALLOWED',
    PROBLEM_INDENTIFY_SITE_ROLE: 'errors.PROBLEM_INDENTIFY_SITE_ROLE',
    ENTITY_DOES_NOT_EXIST: 'errors.ENTITY_DOES_NOT_EXIST',
    STATE_CHAIN_HACKING_ATTEMPT:
      'This state chain has been corrupted. Possible attempts at hacking this system have been made',
    STATE_CHAIN_PREVIOUS_REQUIRED:
      'To add a new non-genesis state a previous state is required',
    STATE_CHAIN_SIGNED_TRANSACTION:
      'State chains require signed state transactions',
    VALID_ENTITY_REQUIRED: 'A valid object entity is required',
    STATE_VALID_SIGNATURE:
      'This valid signature is required before signing this state',
    STATE_OWN_SIGNATURE: 'You cannot sign states for other entities',
    TOKEN_ISSUE_FAILURE: 'Failed to issue request token',
    APPROVAL_TOKEN_REQUIRED: 'Approval token has Expired',
    APPROVAL_TOKEN_NOT_VERIFIED: 'This token cannot be verified',
    IMMUTABLE_DATA:
      'This data can no longer be changed because it has already has a valid signature',
    NO_COST_CODE_AMOUNT: 'The amount value cannot be null',
    NOT_A_COST_CODE_TRANSACTION:
      'A costcode transaction must contain both from and to parameters',
    NOT_PERMITTED_TO_PERFORM_THIS_ACTION:
      'You are not permmitted to perform this action'
  },
  ALLOWED: true,
  REJECTED: true,
  SITE_NAME: 'Parabl',
  upload: sails.config.appPath + '/storage',
  TRACK_GET: false,
  ACTIVITY_RESTRICT_PATH: ['/count'],
  months: {
    JANUARY: 'labels.JANUARY',
    FEBRURARY: 'labels.FEBRURARY',
    MARCH: 'labels.MARCH',
    APRIL: 'labels.APRIL',
    MAY: 'labels.MAY',
    JUNE: 'labels.JUNE',
    JULY: 'labels.JULY',
    AUGUST: 'labels.AUGUST',
    SEPTEMBER: 'labels.SEPTEMBER',
    OCTOBER: 'labels.OCTOBER',
    NOVEMBER: 'labels.NOVEMBER',
    DECEMBER: 'labels.DECEMBER',
    byLabel: function(month) {
      switch (month) {
        case this.JANUARY:
          return 1;
        case this.FEBRURARY:
          return 2;
        case this.MARCH:
          return 3;
        case this.APRIL:
          return 4;
        case this.MAY:
          return 5;
        case this.JUNE:
          return 6;
        case this.JULY:
          return 7;
        case this.AUGUST:
          return 8;
        case this.SEPTEMBER:
          return 9;
        case this.OCTOBER:
          return 10;
        case this.NOVEMBER:
          return 11;
        case this.DECEMBER:
          return 12;
      }
    },

    byInteger: function(month) {
      switch (month) {
        case 1:
          return this.JANUARY;
        case 2:
          return this.FEBRURARY;
        case 3:
          return this.MARCH;
        case 4:
          return this.APRIL;
        case 5:
          return this.MAY;
        case 6:
          return this.JUNE;
        case 7:
          return this.JULY;
        case 8:
          return this.AUGUST;
        case 9:
          return this.SEPTEMBER;
        case 10:
          return this.OCTOBER;
        case 11:
          return this.NOVEMBER;
        case 12:
          return this.DECEMBER;
      }
    },

    all: function() {
      return [
        this.JANUARY,
        this.FEBRURARY,
        this.MARCH,
        this.APRIL,
        this.MAY,
        this.JUNE,
        this.JULY,
        this.AUGUST,
        this.SEPTEMBER,
        this.OCTOBER,
        this.NOVEMBER,
        this.DECEMBER
      ];
    }
  },
  getPdfFonts: function() {
    const fonts = {
      Roboto: {
        normal:
          'node_modules/similie-styles/src/fonts/Roboto/Roboto-Regular.ttf',
        bold: 'node_modules/similie-styles/src/fonts/Roboto/Roboto-Medium.ttf',
        italics:
          'node_modules/similie-styles/src/fonts/Roboto/Roboto-Italic.ttf',
        bolditalics:
          'node_modules/similie-styles/src/fonts/Roboto/Roboto-MediumItalic.ttf'
      }
    };

    return fonts;
  }
};
