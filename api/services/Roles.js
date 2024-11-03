const roles = {
  SIMILIE_ADMIN: 9,
  DOMAIN_ADMIN: 8,
  SITE_ADMIN: 7,
  USER_ADMIN: 6,
  MANAGER: 5,
  RECORDER: 4,
  REPORTER: 3,
  SURVEYOR: 2,
  VISITOR: 1,
  ANONYMOUS: 0,
  getRole: function(user, role) {
    /*
    * @TODO::: LOGIC NEEDS LOTS OF TESTING
    */
    // if we have a similie or domain admin
    // return that role. They always have access
    if (User.is(user, Roles.DOMAIN_ADMIN)) {
      // if we specify a role, go with that
      return (role || user.site_role );
      // if the role is specified, do that
    } else if (role != null) {
      return role;
    } else {
      // if we have the local role go first, then the site, otherwise
      // we are gong teo send an annoymous role
      return (user.role || user.site_role || Roles.ANONYMOUS);
    }
  }
};
roles.DEFAULT = roles.REPORTER;
module.exports = roles;
