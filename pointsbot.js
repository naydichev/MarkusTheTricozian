var debug = process.env.debug || false;
var stage = process.env.stage || "prod";
if (!process.env.token) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

var Botkit = require('../node_modules/botkit/lib/Botkit.js');
var sqlite3 = require('sqlite3').verbose();
var os = require('os');
var fs = require('fs');

var settings = {
    token: process.env.token,
    dbPath: 'botstorage-' + stage + '.db',
};

var controller = Botkit.slackbot({
    json_file_store: 'botstorage-' + stage,
    stale_connection_timeout: 15000,
    debug: debug,
    send_via_rtm: false,
});

// Setup Markus
var Markus = function Constructor(settings) {
    this.bot = controller.spawn({
        token: settings.token
    });

    this.settings = settings;
    this.dbPath = settings.dbPath;
    this.db = null;
};

Markus.prototype._connectDb = function() {
    if (!fs.existsSync(this.dbPath)) {
        console.error('Database path ' + '"' + this.dbPath + '"does not exist, creating it.');
        fs.closeSync(fs.openSync(this.dbPath, 'w'));
    }

    this.db = new sqlite3.Database(this.dbPath);
}

Markus.prototype._createTables = function() {
    if (!this.db) {
        console.error('Database does not exist');
        process.exit(1);
    }

    // create `points` table
    this.db.run("CREATE TABLE IF NOT EXISTS points (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT, point_type TEXT, amount INTEGER, giver TEXT)");

    // prepare a `save_points` statement
    this.save_points_stmt = this.db.prepare("INSERT INTO points (giver, recipient, point_type, amount) VALUES (?, ?, ?, ?)");
}

Markus.prototype._onStart = function(settings) {
    this._connectDb();
    this._createTables();
    this.bot.startRTM();
}

Markus.prototype.run = function() {
    this._onStart();
};

// saves points to the database
Markus.prototype.save_points = function(giver, recipient, point_type, amount) {
    this.save_points_stmt.run(giver, recipient, point_type, amount);
};


// Create markus
markus = new Markus(settings);
markus.run();

// convenience method to add a reaction to a message
function add_reaction(bot, message, name) {
    name = name || 'robot_face';

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: name,
    }, function (err, res) {
        if (err) {
            bot.botkit.log('Failed to add emoji to message ' + message, err);
        }
    });
}

// rate limits (eventually) to prevent users from constantly spamming the bot
function check_ratelimit(bot, message, ratelimit_type, callback) {
    var user = message.user;

    // TODO - remove the below and make sure rate limiting work before
    // jacob writes his own bot.

    if (true) {
        callback();
        return;
    }

    console.log("checking ratelimit for " + ratelimit_type + " for user " + user);
    controllers.storage.users.get(user, function(err, user_data) {
        if (!err && user_data) {
            var last_message = user_data.ratelimit[ratelimit_type];
            if (last_message && last_message + 500 < message.ts) {
                // too soon
                console.log("too soon, returning");
                return;
            }
        }

        if (!user_data) {
            user_data = {
                ratelimit: {}
            };
        }

        user_data.ratelimit[ratelimit_type] = message.ts;

        console.log("saving user data " + JSON.stringify(user_data));
        controllers.storage.users.save({id: user, ratelimit:user_data.ratelimit});

        console.log("calling callback");
        callback();
    });
}

function generate_point_type_lookup_key(message, point_type) {
    return message.team + "-points";
}

// retrieves points from botkit storage
function get_points(bot, message, callback) {
    var points = controller.storage.teams.get(generate_point_type_lookup_key(message), function(err, team_data) {
        if (err || !team_data) {
            team_data = {
                points: {}
            };
        }

        callback(team_data.points || {});
    });
}

// retrieves points for a specific id from botkit storage
function get_points_for(bot, message, point_type, id, callback) {
    point_type = point_type.trim().toLowerCase();
    function inner_callback(points) {
        var specific_point_types = points[point_type] || {};
        callback(bot, message, point_type, id, specific_point_types[id] || 0);
    }

    get_points(bot, message, inner_callback);
}

// saves the points using botkit storage and into the db
function save_points(bot, message, point_type, id, amt) {
    function callback(points) {
        point_type = point_type.trim().toLowerCase();
        if (!points[point_type]) {
            points[point_type] = {};
        }

        points[point_type][id] = amt;

        controller.storage.teams.save({id: generate_point_type_lookup_key(message), points: points}, function(err) {
            if (err) {
                throw new Error(err);
            }
            markus.save_points(message.user, id, point_type, amt);
            print_points_for(bot, message, point_type, id);
        });
    }

    get_points(bot, message, callback);
}

// special feature request
controller.hears(["abhi"], "ambient,mention,direct_mention,direct_message", function(bot, message) {
    bot.reply(message, get_abhi_message());
});

function get_abhi_message() {
    var possible_messages =
        ["Abhi is great.",
         "She's Abhi-lievable!",
         "Did someone say Abhi?  I've heard about her. She's great."];

    return possible_messages[getRandomInt(0,possible_messages.length)];
}

// fetches the username from slack api
function fetch_user(bot, user, callback) {
    bot.api.users.info({token: settings.token, user: user}, callback);
}

function generate_hello_message_for(who) {
    // simple for now, maybe we can do lookups for things in the future
    var possible_messages = [
        "heya " + who + ", how are ya?",
        "hi " + who + "!",
        "sup " + who,
        "oh hey " + who
    ];

    return possible_messages[getRandomInt(0, possible_messages.length)];
}

// just says hi. we don't store the user.name currently, so it will always say Hello.
controller.hears(["hello", "hi"], 'direct_message,direct_mention,mention', function(bot, message) {
    add_reaction(bot, message);

    fetch_user(bot, message.user, function (err, data) {
        if (err) {
            console.error("got error: " + err);
            return;
        }

        var user = data.user;
        var first_name = user.real_name.split(" ")[0];
        if (user.profile && user.profile.first_name) {
            first_name = user.profile.first_name;
        }
        bot.reply(message, generate_hello_message_for(first_name));
    });
});

// 'points' awards
controller.hears([/([-\+]?\d+) ([:\w\s]{0,50}) to (.*)/], "ambient,mention,direct_mention", function(bot, message) {
    add_reaction(bot, message);

    var amount = parseInt(message.match[1]);
    var point_type = message.match[2];
    var id = message.match[3];

    // ensure we're not giving ourselves points
    if (id.slice(2, -1) == message.user) {
        bot.reply(message, "You can't give yourself points, fool!");
        return;
    }

    // range check
    if (points_award_range_check(amount)) {
        bot.reply(message, get_sassy_range_error());
        return;
    }

    // use a ratelimiter to stop abusers
    check_ratelimit(bot, message, "points", function() {
        // inner callback
        // -takes the result of get_points_for
        // - adds new points to existing points
        // - saves the points
        function callback(bot, message, point_type, id, existing_points) {
            console.log(existing_points + " " + point_type + " for " + id);
            var points = existing_points + amount;

            save_points(bot, message, point_type, id, points);
        }

        get_points_for(bot, message, point_type, id, callback);
    });
});

function points_award_range_check(amount) {
    return Math.abs(amount) < 20;
}

function get_sassy_range_error() {
    var possible_messages =
        ["Foolish human.  Point amount of out range: -20 <= points <= 20",
         "Do I look like a points fairy to you?"]

    return possible_messages[getRandomInt(0,possible_messages.length)]
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

// convenience function to print the number of points someone has
function print_points_for(bot, message, point_type, id) {
    get_points_for(bot, message, point_type, id, function (bot, message, point_type, id, points) {
        bot.reply(message, id + " has " + points + " " + point_type);
    });
}

// point checker
controller.hears([/how many ([:\w\s]{0,50}) do(es)? (.*) have/i], "ambient,direct_message,direct_mention,mention", function(bot, message) {
    add_reaction(bot, message);

    var point_type = message.match[1]
    var id = message.match[3];
    var lower_id = id.trim().toLowerCase();

    // we can switch 'i' to the user
    if (lower_id == 'i') {
        id = "<@" + message.user + ">";
    }

    // 'everyone' is a special case
    if (lower_id == 'everyone') {
        get_points(bot, message, function(points) {
            var points_of_type = points[point_type];
            var summary = []

            for (var who in points_of_type) {
                if (points_of_type.hasOwnProperty(who)) {
                    summary.push(who + " has " + points_of_type[who]);
                }
            }

            var words = "nobody has any " + point_type;
            if (summary.length) {
                words = "here's a summary of how many " + point_type + " everyone has: " + summary.join(", ");
            }

            bot.reply(message, words);
        });
    } else {
        // default case, lookup the id
        print_points_for(bot, message, point_type, id);
    }
});

// random advice, prints messages 5% of the time
controller.hears(["(.*)"], "ambient", function(bot, message) {
    var text = message.match[1];

    var num = getRandomInt(0, 100);
    var chance = num <= 5;
    if (chance) {
        // TODO - implement this
        console.log("everyone is missing out on my sage wisdom.");
        // bot.reply(message, sage_wisdom.php);
    }
});
