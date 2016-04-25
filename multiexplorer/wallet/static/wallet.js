var bip44_coin_types = {};
$.each(crypto_data, function(i, data) {

    var network = {};
    network.alias = data['code'];
    network.name = data['name'];
    network.pubkeyhash = data['address_byte'];
    network.privatekey = data['private_key_prefix'];
    bip44_coin_types[data['code']] = data['bip44'];

    if(data['code'] != 'btc') {
        bitcore.Networks.add(network);
    }
});

function arrayRotate(arr, reverse){
    // taken from http://stackoverflow.com/a/23368052/118495
    if(reverse)
        arr.unshift(arr.pop());
    else
        arr.push(arr.shift());
    return arr;
}

function get_crypto_root(crypto) {
    var bip44_coin_type = undefined;
    var address_byte = undefined;
    var bip44 = bip44_coin_types[crypto];

    if(crypto == 'btc') {
        crypto = 'livenet';
    }
    //                         purpose       coin type
    return hd_master_seed.derive(44, true).derive(bip44);
}

function derive_addresses(xpriv, crypto, change, index) {
    //           account             change             index
    xpriv = xpriv.derive(0, true).derive(change ? 1 : 0).derive(index);

    if(crypto == 'btc') {
        crypto = 'livenet';
    }

    var wif = bitcore.PrivateKey(xpriv.privateKey.toString(), crypto).toWIF();
    return [wif, xpriv.privateKey.toAddress(crypto).toString()];
}

function get_deposit_keypair(crypto, index) {
    return derive_addresses(get_crypto_root(crypto), crypto, false, index);
}

function get_change_keypair(crypto, index) {
    return derive_addresses(get_crypto_root(crypto), crypto, true, index);
}

function calculate_balance(crypto, addresses) {
    // active_deposit_addresses == list of dposit addresses that have acivity
    // these addresses will make up the balance. (plus the change addresses
    // which will be made in another concurrent thread)

    console.log("calculate balances with:", addresses);

    var box = $(".crypto_box[data-currency=" + crypto + "]");

    var args = "?addresses=" + addresses.join(",") + "&currency=" + crypto;
    $.ajax({
        'url': "/api/address_balance/private5" + args,
        'type': 'get',
    }).success(function (response) {
        var existing = parseFloat(box.find(".crypto_balance").text());
        box.find(".crypto_balance").text(existing + response.balance.total);
    });
}

var unused_deposit_addresses = {};
var unused_change_addresses = {};
function fetch_used_addresses(crypto, chain, callback, blank_length, already_tried_addresses, all_used) {
    // iterates through the deposit chain until it finds 20 blank addresses.

    var addresses = [];
    var i = 0;
    while(addresses.length < blank_length) {
        if(chain == 'deposit') {
            var gen = get_deposit_keypair(crypto, i)[1];
        } else if (chain == 'change') {
            var gen = get_change_keypair(crypto, i)[1];
        }
        if(already_tried_addresses.indexOf(gen) == -1) {
            addresses.push(gen);
        }
        i += 1;
    }

    //console.log("making call with addresses:", addresses);

    var addresses_with_activity = [];
    if(addresses.length == 1) {
        var args = "?address=" + addresses[0] + "&currency=" + crypto;
        var mode = "fallback";
    } else {
        var args = "?addresses=" + addresses.join(",") + "&currency=" + crypto;
        var mode = "private5";
    }

    args += "&full_fetch=true";

    $.ajax({
        'url': "/api/historical_transactions/" + mode + "/" + args,
        'type': 'get',
    }).success(function (response) {
        $.each(response['transactions'], function(i, tx) {
            //console.log("found tx!", tx);
            var all_addresses = tx.inputs.concat(tx.putputs);
            $.each(tx.addresses, function(i, address) {
                //console.log('trying address', address);
                var not_already_marked = addresses_with_activity.indexOf(address) == -1;
                if(not_already_marked) {
                    //console.log("adding to used list", address);
                    addresses_with_activity.push(address);
                }
            });
        });
        //console.log(crypto, 'activity found this round:', addresses_with_activity);
        //console.log(crypto, "pre all_used", all_used);

        var all_tried = addresses.concat(already_tried_addresses);
        var all_used = addresses_with_activity.concat(all_used || []);

        //console.log("all tried", all_tried);
        //console.log(crypto, "all used", all_used);

        var needs_to_go = addresses_with_activity.length;
        if(needs_to_go == 0) {
            // all results returned no activity
            var i = 0;
            var unused_address_pool = [];
            while(unused_address_pool.length < 5) {
                if(chain == 'deposit') {
                    var gen = get_deposit_keypair(crypto, i)[1];
                } else if (chain == 'change') {
                    var gen = get_change_keypair(crypto, i)[1];
                }
                var not_used = all_used.indexOf(gen) == -1;
                var not_already_added = unused_address_pool.indexOf(gen) == -1;
                if(not_used && not_already_added) {
                    // If newly generated address has not already been used,
                    // add it to the pool. Otherwise generate another and check again.
                    unused_address_pool.push(gen);
                }
                i += 1;
            }
            if(chain == 'deposit') {
                unused_deposit_addresses[crypto] = unused_address_pool;
            } else if (chain == 'change') {
                unused_change_addresses[crypto] = unused_address_pool;
            }

            //console.log(crypto, 'finished fetch!:', addresses, chain, all_used);
            callback(all_used);
        } else {
            //console.log(crypto, 'recursing:', needs_to_go, all_tried, all_used);
            fetch_used_addresses(crypto, chain, callback, needs_to_go, all_tried, all_used);
        }
    });
}

function rotate_deposit(crypto, up) {
    var pool = unused_deposit_addresses[crypto];
    unused_deposit_addresses[crypto] = arrayRotate(pool, up);
    return pool[0];

}

function open_wallet() {
    $("#register_box, #login_box").hide();
    $("#loading_screen").show();
    console.log("start");

    $.each(crypto_data, function(i, data) {
        var crypto = data.code;
        var box = $(".crypto_box[data-currency=" + crypto + "]");

        fetch_used_addresses(crypto, 'deposit', function(used_addresses) {
            console.log(crypto, "======== found deposit addresses:", used_addresses);

            var address = unused_deposit_addresses[crypto][0];
            box.find(".deposit_address").text(address);
            box.find(".qr").empty().qrcode({render: 'div', width: 100, height: 100, text: address});

            if(used_addresses.length == 0) {
                // if the external chain has no activity, then the internal chain
                // must have none either.
                box.find(".crypto_balance").text("0.0");
            } else {
                calculate_balance(crypto, used_addresses);
            }
        }, 10, [], []);

        fetch_used_addresses(crypto, 'change', function(used_addresses) {
            console.log("used addresses", used_addresses);
            if(used_addresses.length > 0) {
                calculate_balance(crypto, used_addresses);
            }
        }, 10, [], []);

        box.find(".deposit_shift_down").click(function() {
            var address = rotate_deposit(crypto, true);
            box.find(".deposit_address").text(address);
            box.find(".qr").empty().qrcode({render: 'div', width: 100, height: 100, text: address});
        });
        box.find(".deposit_shift_up").click(function() {
            var address = rotate_deposit(crypto, false);
            box.find(".deposit_address").text(address);
            box.find(".qr").empty().qrcode({render: 'div', width: 100, height: 100, text: address});
        });
    });

    $("#loading_screen").hide();
    $("#wallets").show();
    console.log('end');
}
