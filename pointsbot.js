var debug = process.env.debug || false;
var stage = process.env.stage || "prod";
if (!process.env.token) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

var Botkit = require('../node_modules/botkit/lib/Botkit.js');
var os = require('os');

var controller = Botkit.slackbot({
    json_file_store: 'botstorage-' + stage,
    stale_connection_timeout: 15000,
    debug: debug,
    send_via_rtm: false,
});

var bot = controller.spawn({
    token: process.env.token
});

bot.startRTM();

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

function check_ratelimit(bot, message, ratelimit_type, callback) {
    var user = message.user;

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

function get_points(bot, message, callback) {
    var points = controller.storage.teams.get(generate_point_type_lookup_key(message), function(err, team_data) {
        if (err || !team_data) {
            team_data = {
                points: {}
            };
        }

        console.log("points: " + JSON.stringify(team_data.points));
        callback(team_data.points || {});
    });
}

function get_points_for(bot, message, point_type, id, callback) {
    point_type = point_type.trim().toLowerCase();
    function inner_callback(points) {
        var specific_point_types = points[point_type] || {};
        console.log("points for " + point_type + ": " + JSON.stringify(specific_point_types));
        callback(bot, message, point_type, id, specific_point_types[id] || 0);
    }

    get_points(bot, message, inner_callback);
}

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
            print_points_for(bot, message, point_type, id);
        });
    }

    get_points(bot, message, callback);
}

controller.hears(["abhi"], "ambient,mention,direct_mention,direct_message", function(bot, message) {
    bot.reply(message, get_abhi_message());
});

function get_abhi_message() {
    var possible_messages = 
        ["Abhi is great.",
         "She's Ahbi-lievable!",
         "Did someone say Abhi?  I've heard about her. She's great."];
         
    return possible_messages[getRandomInt(0,possible_messages.length)];
}

controller.hears(["hello", "hi"], 'direct_message,direct_mention,mention', function(bot, message) {
    add_reaction(bot, message);

    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Hello ' +user.name + '!!');
        } else {
            bot.reply(message, 'Hello.');
        }
    });
});

controller.hears([/([-\+]?\d+) ([:\w\s]{0,50}) to (.*)/], "ambient,mention,direct_mention", function(bot, message) {
    console.log("add points call");
    add_reaction(bot, message);

    var amount = parseInt(message.match[1]);
    var point_type = message.match[2];
    var id = message.match[3];

    if (id.slice(2, -1) == message.user) {
        bot.reply(message, "You can't give yourself points, fool!");
        return;
    }

    console.log("amount: " + amount + "; point_type: " + point_type + "; id: " + id);

    if (amount > 20 || amount < -20) {
        bot.reply(message, get_sassy_range_error());
        return;
    }

    check_ratelimit(bot, message, "points", function() {
        console.log("passed ratelimit check");
        function callback(bot, message, point_type, id, existing_points) {
            console.log(existing_points + " " + point_type + " for " + id);
            var points = existing_points + amount;

            save_points(bot, message, point_type, id, points);
        }

        get_points_for(bot, message, point_type, id, callback);
    });
});

function get_sassy_range_error() {
    var possible_messages =
        ["Foolish human.  Point amount of out range: -20 <= points <= 20",
         "Do I look like a points fairy to you?"]

    return possible_messages[getRandomInt(0,possible_messages.length)]
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function print_points_for(bot, message, point_type, id) {
    get_points_for(bot, message, point_type, id, function (bot, message, point_type, id, points) {
        bot.reply(message, id + " has " + points + " " + point_type);
    });
}

controller.hears([/how many ([:\w\s]{0,50}) do(es)? (.*) have/i], "ambient,direct_message,direct_mention,mention", function(bot, message) {
    add_reaction(bot, message);

    var point_type = message.match[1]
    var id = message.match[3];

    if (id.trim().toLowerCase() == 'i') {
        id = "<@" + message.user + ">";
    }

    print_points_for(bot, message, point_type, id);
});
