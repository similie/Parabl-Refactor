# Parabl Requirements version 1.1

- [Node v20.x](https://github.com/nvm-sh/nvm)
- NPM
- Docker
- Postgis v11
- Redis

# Overview

Parable is a content management system for your data. It allows your users to create complex datasets and manage that data through enterprise-grade resources. It features a comprehensive asset and people management system for connecting your data to your teams. In addition, users can leverage the power IoT data collection and set automated thresholds to trigger advanced warnings for potentially disriputive events.

#Parabl

- Geospacial data management
- Station-based contexts for managing a large number of deployed data contexts
- Data pre-processing based on excel-based user inputs or well defined SQL aggregation queries
- Task-based messaging and coordination tools
- Any language configurable
- Domain-based federation

#Reports

- Configurable dashboards for data visualization
- Tell stories using realtime data with storyboards
- Activate automatic data aggregation and reporting capabilities

#Events

- Automatic event-based messaging system for new data records
- Fully customizable datasets creation
- IoT device management and configuration
- Advanced reporting features
- Disaster reponse tools for coordinating risks (Future Builds Requires Assets and People)
- Integration with social media chatbots/ChatGPT for crowd-sourcing event activities and risks (Future builds)
- Machine-learning, advanced modeling post-processing for maintaining and managing complex datasets (Future Builds)

#Assets

- Purchase Orders for internal and external goods movement.
- Transport of goods directly tracked in currier assets (_Requires People_)
- Scheduled Stocktake for periodic inventory counts and accountability
- Workorders for asset maintenance and repeatable work activities
- Point of sale distribution for internal/external clients
- Blockchain-based cost-coded budgetting

#People

- Configurable personnel profile details.
- Rank management
- Work history and career progression scheduling
- System access and roles management
- Right-fit internal candidate profiling based on career progression rules
- Asset assignment for serialized inventory (_Requires Assets_)
- Job-based system access and permissions

#Metering (_FUTURE: Requires Events, Assets, and People_)

- Automatically calculate resources costs using our IoT framework
- Create periodic customer billing for metered resources
- Monitor resource health and automatically adjust/coordinate variable input parameters based on current conditions (SCADA)
- Maintain comprehenisive cost/revenue capabilities.
- Customer-relations/retentions portal

# Get Started

Install node version 20. Given we support other resources that leverage later versions of node, we recommend installing node via [nvm](https://github.com/nvm-sh/nvm) . This will alow you to easily switch between the various node versions needed to support Similie's software stack.

For development environments, we recommend using docker for deploying auxilary resources such as Postgis and Redis.

Create a postgis and redis databases. You can use your local installations, however, The instructions below assume you are using Docker to install these resources:

## Postgis Database

The system employs a PostGIS database. To get the database running, use the docker command:

```
// note: we recently updated to node 20. Later versions of postgres are likely compatible, but untested
docker run --name postgis -v ~/postgres:/var/lib/postgresql --restart=always -p 5432:5432 -e POSTGRES_PASSWORD=wrdims -e POSTGRES_USER=wrdims -d mdillon/postgis:11-alpine
```

For those using arm-based mac/linux machines, we have a repository of an arm-compatible version of Postgis. Simply clone the repository and run `docker build .`

Create a database. In the following example, we create a database called: "parable"

Once you've created the DB, you can restore it from the [x].bak file such as "parabl.bak" we provide for development enviroments:

```
# using a preinstalled local postgres client
PGPASSWORD="wrdims" pg_restore -h postgis -U wrdims --no-owner --role=wrdims -Fc -d parabl parabl.bak

# place the db file in ~/postgres and ran through docker
docker exec postgis-arm pg_restore -h localhost -U wrdims --no-owner --role=wrdims -Fc -d parable /var/lib/postgresql/parble.bak
```

_Note: if you receive an error `pg_restore: [archiver] unsupported version (x.x.x) in file header` this means that the .bak was create with another version of pg-client. You will need to create another backup file or update your version of pg-client_

To set the database for Parabl type into console:

```
export POSTGIS_DB=parabl
```

## Session

Session and Async Queue storage is managed by redis. To run a Redis server, run the following docker command

```
docker run --name redis --restart=always -d -p 6379:6379 redis
```

## Host files for develoment

To have a local build that doesn't require environment variables, you should append your /etc/hosts file with the following lines:

```
127.0.0.1 postgis
127.0.0.1 redis
```

## Parabl Dependecies

Navigate into the One's root directory via the terminal. Before you can install, you must [add your ssh keys](https://help.github.com/en/enterprise/2.15/user/articles/adding-a-new-ssh-key-to-your-github-account) to Github. There are dependencies on Similie's private respositories that are pulled via ssh.

```
cd parabl
```

and run the following:

```
npm install
```

## Seeding Parabl

If starting Parabl using a template DB then you can skip this section. To start system with a fresh database, the first time you run the applicaltion you will need to place the system into a database migration state. To do this simply export the following environment variable:

```
export MIGRATION=alter
```

Caution: do not end the migration process until you see the following console output (seed count values may vary):

```
debug: -------------------------------------------------------
debug: :: Fri May 24 2019 13:32:37 GMT+0900 (+09)
debug: Environment : development
debug: Port        : 1337
debug: -------------------------------------------------------
SEED COUNT for user 4
SEED COUNT for variable 1523
SEED COUNT for site 2
SEED COUNT for icon 244
SEED COUNT for tag 17
SEED COUNT for district 2743
SEED COUNT for geofeature 115
SEED COUNT for domain 1
SEEDING COMPLETE
```

Once this is complete, it is hightly recommended that you stop the webserver and set:

```
export MIGRATION=
```

There are two resons for this. The primary reason is data loss. If the webserver restart is interrupted before the migration terminates, data loss will occur. The second reson is load time. In the migration state, we will see significant load times. Additionally, under some configurations, the system may fail to load due to database view dependancies.

## Starting One

Before starting, some databases will require that you run `export CLOUD_DPLOYMENT=true`. If after running the application and there are issues with files, stop the service and run the export command in the same terminal session to resolve this issue.

To start Parbl in development, run

```
npm run dev
```

## Multi Server Build

Our multi-server build is used to support our 1.5 or micro-services transition. To activate this service, please run before starting your server

```
export MULTI_SERVER=true
```

Note: do not run this without the proxy server and the authentication service running. This system will be unable to support login functionality or route users to their authentication services

Navigate to http://localhost:1337 to access Parabl. _Note:_ given the way webpack

To run the application in production

Framework documentation v1.1:

[Sails.js](https://0.12.sailsjs.com/) v0.12

[AngularJS](https://angularjs.org/) v1.4.8

[Bull](https://optimalbits.github.io/bull/) Manages redis-based async job queues

[Knexjs](https://knexjs.org/) Manages the node entity ORM

[Bootstrap UI](https://angular-ui.github.io/bootstrap/versioned-docs/0.14.3/)

[Add your ssh key to Github](https://help.github.com/en/enterprise/2.15/user/articles/adding-a-new-ssh-key-to-your-github-account)

[Bootstrap 3](https://getbootstrap.com/docs/3.4/)
