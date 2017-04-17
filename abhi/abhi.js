module.exports = 
{
  hears: function(bot, message) {
    bot.reply(message, get_abhi_message());
  },
};

function get_abhi_message() {
    var possible_messages =
        ["Abhi is great.",
         "She's Abhi-lievable!",
         "Did someone say Abhi?  I've heard about her. She's great."];
    
    return possible_messages[getRandomInt(0,possible_messages.length)];
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}