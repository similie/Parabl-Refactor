/**
 * UserActivityController
 *
 * @description :: Server-side logic for managing Useractivities
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
const escape = require('pg-escape');
const Q = require('q');
const lodash = require('lodash');

module.exports = {
  /*

    // offers the total for all pages
    SELECT "path", count(*) from useractivity WHERE event = 'client_page_explored' AND "path" NOT LIKE '%?routeTo=%' GROUP BY "path"  ORDER BY 2 DESC LIMIT 10 ;
    // We are selecting the
    SELECT "user", COUNT(*) as login_count from useractivity WHERE event = 'user_local_login' GROUP BY "user" ORDER BY login_count DESC;
    // We are getting the most time logged in
    SELECT "user", SUM(EXTRACT(EPOCH FROM "updatedAt" - "createdAt")) AS duration_seconds FROM useractivity WHERE event = 'user_local_login' AND resolution = 'user_local_logout' OR resolution = 'expired_user_session' GROUP BY "user" ORDER BY duration_seconds DESC;
    // We are getting the build of the user data
    // SELECT u.avatar, u.username, u.first_name, u.last_name, u.id, SUM(EXTRACT(EPOCH FROM "ua"."updatedAt" - "ua"."createdAt")) AS duration_seconds FROM "useractivity" ua JOIN "user" u ON u.id = ua.user WHERE event = 'user_local_login' AND resolution = 'user_local_logout' OR resolution = 'expired_user_session'  GROUP BY u.id ORDER BY duration_seconds DESC;

    */

  leaderboard: function(req, res) {
    async.parallel(
      {
        page_counts: function(cb) {
          const q = escape(
            'SELECT "user", count(*) as page_counts, u.first_name, u.last_name, u.username, u.email, u.avatar::jsonb  from useractivity ua LEFT JOIN "user" u ON (u.id = ua.user) WHERE u.active = TRUE AND u.archive = FALSE AND event = \'client_page_explored\' AND "path" NOT LIKE \'%?routeTo=%\' GROUP BY ua.user, u.id ORDER BY u.count DESC ;'
          );
          UserActivity.query(q, (err, results) => {
            const res = (results || {}).rows;

            cb(err, res);
          });
        },
        login_counts: function(cb) {
          const q = escape(
            'SELECT "user", COUNT(*) as login_counts, u.first_name, u.last_name, u.username, u.email, u.avatar::jsonb from useractivity ua LEFT JOIN "user" u ON (ua.user = u.id) WHERE u.active = TRUE AND u.archive = FALSE AND  event = \'user_local_login\' GROUP BY "user", u.id ORDER BY login_counts DESC;'
          );
          UserActivity.query(q, (err, results) => {
            const res = (results || {}).rows;

            cb(err, res);
          });
        },
        time_online: function(cb) {
          Q.fcall(() => {
            const deferred = Q.defer();
            // var q = escape('SELECT DISTINCT ON ("user") "user", "ua"."createdAt" , EXTRACT(EPOCH FROM "ua"."updatedAt" - "ua"."createdAt") as time_online, u.username, u.first_name, u.last_name, u.email, u.avatar::jsonb from "useractivity" as ua LEFT JOIN "user" u ON u.id = ua.user WHERE event = \'user_local_login\' AND resolution IS NOT NULL GROUP BY  "user", time_online, ua.id, u.id ORDER BY "user", "ua"."createdAt" DESC;');
            const q = escape(
              'SELECT "user", SUM(EXTRACT(EPOCH FROM "ua"."updatedAt" - "ua"."createdAt")) AS time_online, u.username, u.first_name, u.last_name, u.email, u.avatar::jsonb  from useractivity ua LEFT JOIN "user" u ON (u.id = ua.user)  where u.active = TRUE AND u.archive = FALSE AND event = \'user_local_login\' AND resolution = \'user_local_logout\' OR resolution = \'expired_user_session\' GROUP BY "user", u.username, u.first_name, u.last_name, u.email, u.avatar::jsonb  ORDER BY time_online DESC'
            );
            // var q = escape('SELECT u.avatar, u.username, u.first_name, u.last_name, u.id, SUM(EXTRACT(EPOCH FROM "ua"."updatedAt" - "ua"."createdAt")) AS duration_seconds FROM "useractivity" ua JOIN "user" u ON u.id = ua.user WHERE event = \'user_local_login\' AND resolution = \'user_local_logout\' OR resolution = \'expired_user_session\'  GROUP BY u.id ORDER BY duration_seconds DESC;');
            UserActivity.query(q, (err, results) => {
              if (err) {
                sails.log.error(err);
                return deferred.reject(err);
              }
              const res = (results || {}).rows;
              deferred.resolve(res);
            });
            return deferred.promise;
          })
            .then(query => {
              /*
               * Now we need to add the time the user is currently active
               */
              const deferred = Q.defer();
              // var q = escape('SELECT DISTINCT ON ("user") "user", "ua"."createdAt", EXTRACT(EPOCH FROM current_timestamp - "ua"."createdAt"), u.first_name, u.last_name, u.email, u.avatar::jsonb as duration_seconds from "useractivity" as ua LEFT JOIN "user" u ON u.id = ua.user WHERE event = \'user_local_login\' AND resolution IS NULL GROUP BY  "user", duration_seconds, ua.id, u.id ORDER BY "user", "ua"."createdAt" DESC;');
              const q = escape(
                'SELECT DISTINCT ON ("user") "user", "createdAt", EXTRACT(EPOCH FROM current_timestamp - "createdAt") as time_online from "useractivity" WHERE event = \'user_local_login\' AND resolution IS NULL GROUP BY  "user", time_online, id ORDER BY "user", "createdAt" DESC;'
              );

              UserActivity.query(q, (err, results) => {
                if (err) {
                  sails.log.error(err);
                  deferred.reject(err);
                }

                const res = (results || {}).rows;

                _.each(res, r => {
                  const user = r.user;

                  const q = _.where(query, { user: user });

                  if (_.size(q)) {
                    q[0].time_online += r.time_online;
                  }
                });

                query = lodash.orderBy(query, ['time_online'], ['desc']);

                deferred.resolve(query);
              });
              return deferred.promise;
            })
            .then(query => {
              cb(null, query);
            })
            .catch(cb);
        }
      },
      (err, results) => {
        if (err) {
          return res.serverError(err);
        }

        res.send(results);
      }
    );
  },

  stats: function(req, res) {
    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({ error: 'errors.USER_ID_REQUIRED' });
    }

    const user = params.id;

    Q.fcall(() => {
      const query = {};

      const deferred = Q.defer();
      const q = escape(
        'SELECT COUNT(*) from useractivity where "user" = %s;',
        user
      );
      UserActivity.query(q, (err, results) => {
        if (err) {
          return deferred.reject(err);
        }

        const res = (results || {}).rows;
        query.total_count = parseInt((res || [{ count: 0 }])[0].count);
        deferred.resolve(query);
      });

      return deferred.promise;
    })

      .then(query => {
        // now now count how many pages they've seen
        const deferred = Q.defer();
        const q = escape(
          'SELECT SUM(EXTRACT(EPOCH FROM "updatedAt" - "createdAt")) AS duration_seconds from useractivity where "user" = %s and event = \'user_local_login\' AND resolution = \'user_local_logout\' OR resolution = \'expired_user_session\';',
          user
        );
        const q2 = escape(
          'SELECT "createdAt", EXTRACT(EPOCH FROM current_timestamp - "createdAt") AS duration_seconds from useractivity where "user" = %s and event = \'user_local_login\' AND resolution IS NULL ORDER BY 1 DESC LIMIT 1;',
          user
        );
        Q.fcall(() => {
          const deferred = Q.defer();

          UserActivity.query(q, (err, results) => {
            if (err) {
              return deferred.reject(err);
            }

            const res = (results || {}).rows;
            query.seconds_online = (res || [{}])[0].duration_seconds || 0;
            deferred.resolve(query);
          });

          return deferred.promise;
        }).then(query => {
          UserActivity.query(q2, (err, results) => {
            if (err) {
              return deferred.reject(err);
            }

            const res = (results || {}).rows;
            query.seconds_online += parseInt(
              (res[0] || {}).duration_seconds || 0
            );
            deferred.resolve(query);
          });
        });

        return deferred.promise;
      })

      .then(query => {
        // now now count how many pages they've seen
        const deferred = Q.defer();
        const q = escape(
          'SELECT COUNT(*) from useractivity where "user" = %s AND event = \'user_local_login\';',
          user
        );
        UserActivity.query(q, (err, results) => {
          if (err) {
            return deferred.reject(err);
          }
          const res = (results || {}).rows;
          query.login_count = parseInt((res || [{ count: 0 }])[0].count);
          deferred.resolve(query);
        });

        return deferred.promise;
      })

      .then(query => {
        // now now count how many pages they've seen
        const deferred = Q.defer();
        const q = escape(
          'SELECT COUNT(*) from useractivity where "user" = %s AND event = \'client_page_explored\';',
          user
        );
        UserActivity.query(q, (err, results) => {
          if (err) {
            return deferred.reject(err);
          }
          const res = (results || {}).rows;
          query.page_count = parseInt((res || [{ count: 0 }])[0].count);
          deferred.resolve(query);
        });

        return deferred.promise;
      })

      .then(query => {
        // now now count how many pages they've seen
        const deferred = Q.defer();
        const q = escape(
          'SELECT "path", count(*) from useractivity where "user" = %s AND event = \'client_page_explored\' AND "path" NOT LIKE \'%%?routeTo=%%\' GROUP BY "path" ORDER BY 2 DESC LIMIT 10;',
          user
        );
        UserActivity.query(q, (err, results) => {
          if (err) {
            return deferred.reject(err);
          }
          const res = (results || {}).rows;
          query.top_pages = res;
          deferred.resolve(query);
        });

        return deferred.promise;
      })

      .then(query => {
        // now now count how many pages they've seen
        const deferred = Q.defer();
        const q = escape(
          'SELECT * from useractivity where "user" = %s AND "path" NOT LIKE \'%%?routeTo=%%\'  ORDER BY "createdAt" DESC limit 20;',
          user
        );
        UserActivity.query(q, (err, results) => {
          if (err) {
            return deferred.reject(err);
          }
          const res = (results || {}).rows;
          query.recent_actions = res;
          deferred.resolve(query);
        });

        return deferred.promise;
      })

      .then(query => {
        res.send(query);
      })
      .catch(err => {
        res.serverError(err);
      });

    // SELECT COUNT(*) from useractivity where "user" = 4;
    // pages explored
    // SELECT COUNT(*) from useractivity where "user" = 4 AND event = 'client_page_explored';
    // NUMBER OF TIMES LOGGED IN
    // SELECT COUNT(*) from useractivity where "user" = 4 and event = 'user_local_login'
    // top pages
    // SELECT "path", count(*) from useractivity where "user" = 4 AND event = 'client_page_explored' GROUP BY "path" ORDER BY 2 DESC;
    // SELECT "path", count(*) from useractivity where "user" = 4 AND event = 'client_page_explored' GROUP BY "path" ORDER BY 2 DESC LIMIT 1;
    // count login attempts
    // SELECT count(*) from useractivity where "user" = 4 AND event = 'user_local_login' ;
    // gives us activities for the last activities
    // SELECT * from useractivity where "user" = 4  ORDER BY "createdAt" DESC;
    // SELECT SUM(EXTRACT(EPOCH FROM "updatedAt" - "createdAt")) AS duration_seconds from useractivity where "user" = 4 and event = 'user_local_login' AND resolution = 'user_local_logout' OR resolution = 'expired_user_session' ;
  }

  /*

    // offers the total for all pages
    SELECT "path", count(*) from useractivity WHERE event = 'client_page_explored' AND "path" NOT LIKE '%?routeTo=%' GROUP BY "path"  ORDER BY 2 DESC LIMIT 10 ;
    // We are selecting the
    SELECT "user", COUNT(*) as login_count from useractivity WHERE event = 'user_local_login' GROUP BY "user" ORDER BY login_count DESC;
    // We are getting the most time logged in
    SELECT "user", SUM(EXTRACT(EPOCH FROM "updatedAt" - "createdAt")) AS duration_seconds FROM useractivity WHERE event = 'user_local_login' AND resolution = 'user_local_logout' OR resolution = 'expired_user_session' GROUP BY "user" ORDER BY duration_seconds DESC;
    // We are getting the build of the user data
    // SELECT u.avatar, u.username, u.first_name, u.last_name, u.id, SUM(EXTRACT(EPOCH FROM "ua"."updatedAt" - "ua"."createdAt")) AS duration_seconds FROM "useractivity" ua JOIN "user" u ON u.id = ua.user WHERE event = 'user_local_login' AND resolution = 'user_local_logout' OR resolution = 'expired_user_session'  GROUP BY u.id ORDER BY duration_seconds DESC;

    */
};
