const Queue = require('bull');
module.exports = class BullQueue {
  static jobTemplate(cb, name, options = {}) {
    return {
      name: name,
      process: function(job) {
        return cb(job);
      },

      stats: SailsExtensions.stats({
        completed: function(...args) {
          return (options.completed || _.noop)(...args);
        },
        failed: function(job, err) {
          console.error(`${name}:ERROR::`, err);
          return (options.failed || _.noop)(err, job);
        }
      })
    };
  }

  getPrefix(value) {
    return `{${value}}`;
  }

  get processMaster() {
    return Site.isProcessMaster();
  }

  get processors() {
    const processors = Jobs._processors;
    for (const key in sails.models) {
      const model = sails.models[key];
      if (!model._processors) {
        continue;
      }
      processors.push(...model._processors);
    }
    return processors;
  }

  get prefix() {
    if (sails.config.session.prefix) {
      return this.getPrefix(sails.config.session.prefix + 'queue_');
    }
    return this.getPrefix(process.env.REDIS_PREFIX || 'sess-one');
  }

  buildPrefixPatternForJobName(name, id = '') {
    return `*${name}${id ? ':' + id : ''}`;
  }

  buildPrefixForJobName(name, id = '') {
    return `${this.prefix}:${name}${id ? ':' + id : ''}`;
  }

  static killJob(job, name) {
    return Jobs[name].removeRepeatableByKey(job.key);
  }

  static async prune(name, pruneMap = {}) {
    const repeatableJobs = await Jobs[name].getRepeatableJobs();
    const removed = [];
    for (const job of repeatableJobs) {
      if (pruneMap[job.id]) {
        continue;
      }
      BullQueue.killJob(job, name);
      removed.push(job);
    }
    return removed;
  }

  static async findRepeatableJobs(name, id = '') {
    const repeatableJobs = await Jobs[name].getRepeatableJobs();
    return repeatableJobs.find(job => job.id === id);
  }

  get redisOptions() {
    const options = {
      redis: {
        host: sails.config.session.host,
        port: sails.config.session.port
      }
    };

    if (sails.config.session.pass) {
      options.redis.password = sails.config.session.pass;
    }
    options.prefix = this.prefix;
    return options;
  }

  static async removeJobItem(job, jobId) {
    const _job = await job.getJob(jobId);
    if (!_job) {
      return null;
    }
    return _job.remove();
  }

  async removeJob(job, jobId) {
    return BullQueue.removeJobItem(job, jobId);
  }

  setGlobalComplete(job) {
    job.on('global:completed', async jobId => {
      sails.log.debug(`Job ${jobId} completed!`);
      // await listJobs(job);
      await BullQueue.removeJobItem(job, jobId);
    });
    job.on('global:failed', async jobId => {
      sails.log.error(`Job ${jobId} falied!`);
      await BullQueue.removeJobItem(job, jobId);
    });
  }

  applyProcess(process, options, repeat = false) {
    const name = process.name;
    Jobs[name] = new Queue(name, options || this.redisOptions);
    const proc = process.process;
    Jobs[name].process(proc);
    process.stats(name);
    if (!this.processMaster) {
      return Jobs[name];
    }
    if (!repeat) {
      this.setGlobalComplete(Jobs[name]);
    }
    return Jobs[name];
  }

  bootstrapJobs() {
    const processors = this.processors;
    const options = this.redisOptions;
    for (let i = 0; i < processors.length; i++) {
      const process = processors[i];
      this.applyProcess(process, options);
    }
  }

  bootstrap() {
    this.bootstrapJobs();
  }
};
