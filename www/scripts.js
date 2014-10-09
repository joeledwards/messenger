$(document).ready(function()
{
    console.log("jQuery is ready");

    var socket = io.connect('/');
    var client_id;
    var client_alias;

    socket.on('welcome', function(data)
    {
        client_id = data.client_id;
        client_alias = "" + client_id;
        console.log("I am client " + client_id);
        $('div.client span').append("" + client_id);
    });

    socket.on('alias', function(data)
    {
        console.log("New alias received: ", data);

        client_alias = Base64.decode(data.alias);
        console.log("I am '" + client_alias + "' (client " + client_id + ")");
        $('div.client span').val(client_alias +" &nbsp; (" + client_id + ")");
        
        $('#alias').val(client_alias);
        $('#alias').addClass('valid-alias');
        $('#alias').removeClass('invalid-alias');
    });

    socket.on('message', function(data)
    {
        console.log("Received message: ", data);

        var classify = data.from == client_id ? "sent" :
            (data.from == 0 ? "server" : "received");
        var who = data.from == client_id ? "me" : Base64.decode(data.alias);

        $('#display').append('<div class="message ' + classify + '"><span class="id">'
            + who +': </span>' + Base64.decode(data.body) + '</div>');

        console.log("    window:", $(window).height());
        console.log("  document:", $(document).height());
        console.log("      html:", $("html").height());
        console.log("      body:", $("body").height());
        console.log("      main:", $("#main").height());
        console.log("   display:", $("#display").height());

        $('#main').scrollTop($('#main').height() - $('body').height());
    });

    $('#alias').keypress(function(e)
    {
        if ($('#alias').val == client_alias)
        {
            $('#alias').addClass('valid-alias');
            $('#alias').removeClass('invalid-alias');
        }
        else
        {
            $('#alias').addClass('invalid-alias');
            $('#alias').removeClass('valid-alias');

            if (e.which == 13)
            {
                var new_alias = $('#alias').val();

                if (new_alias)
                {
                    console.log("requesting alias '" + new_alias + "'");
                    socket.emit('alias', {
                        alias : Base64.encode("" + new_alias)
                    });
                }
            }
        }
    });

    $('#msg').keypress(function(e)
    {
        if (e.which == 13)
        {
            var message = $('#msg').val();
            $('#msg').val('');
            console.log("message: " + message);

            socket.emit('broadcast', {
                body : Base64.encode(message)
            });

            return false;
        }
    });

    $('#msg').focus();
});
