"use strict";
module.exports = {
    Account: Account
};


var http = require('http');
var querystring = require('querystring');
var CONST = {
    CLIENT_NAME: 'CrazyNigerTradeService-0.1',
};

function parseCookies(cookieSets) {
    var list = {};
    if (cookieSets && typeof cookieSets.length != 'undefined') {
        for(var i = 0; i < cookieSets.length; i++) {
            var rawCookie = cookieSets[i].split(';')[0].split('=');
            list[rawCookie[0]] = rawCookie[1];
        }
    }
    return list;
}

/**
 *
 * @param email
 * @param password
 * @constructor
 */
function Account(email, password) {
    this.email = email;
    this.password = password;

    this.sessionId = null;
    this.csrfToken = null;
    this.expirationTime = null;
    this.lastServerTime = null;

    this.lastGameTime = null;

    this.accountId = null;
    this.accountName = null;

    /**
     * Выполнение авторизации в API Сказки
     * @param {function} [callback]
     */
    this.login = function(callback) {
        this.sessionId = null;
        var options = {
            hostname: 'the-tale.org',
            port: 80,
            path: '/accounts/auth/api/login?api_version=1.0&api_client=' + CONST.CLIENT_NAME
        };
        var account = this;
        http.get(options, function processToken(res){
            var cookies = parseCookies(res.headers['set-cookie']);
            if (typeof cookies['csrftoken'] == 'undefined') {
                console.log(new Date(), "Error get to csrftoken");
                setTimeout(function(){
                    account.login(callback);
                }, 300000);
                return;
            }
            account.csrfToken = cookies['csrftoken'];
            var data = "email=" + account.email + "&password=" + account.password;
            var options = {
                hostname: 'the-tale.org',
                port: 80,
                path: '/accounts/auth/api/login?api_version=1.0&api_client=' + CONST.CLIENT_NAME,
                method: 'POST',
                headers: {
                    'Content-length': data.length,
                    'Content-type': 'application/x-www-form-urlencoded',
                    'Cookie': 'csrftoken=' + account.csrfToken,
                    'X-CSRFToken': account.csrfToken
                }
            };
            var req = http.request(options, function checkProcess(res) {
                var cookies = parseCookies(res.headers['set-cookie']);
                res.setEncoding('utf8');
                var body = '';
                res.on('data', function (chunk) {
                    body += chunk;
                });
                res.on('end', function processLoginResponse(chunk) {
                    var data = JSON.parse(body);
                    if (data.status == 'ok') {
                        account.csrfToken = cookies.csrftoken;
                        account.sessionId = cookies.sessionid;
                        account.expirationTime = data.data.session_expire_at;
                        account.accountName = data.data.account_name;
                        account.accountId = data.data.account_id;
                        if (typeof callback === 'function') {
                            callback(null, account);
                        }
                    } else {
                        if (typeof callback === 'function') {
                            var err = new Error("Fail on login");
                            err.data = data;
                            callback(err, account);
                        }
                    }
                })
            }).on('error', function loginCallbackWithError(err) {
                if (typeof callback === 'function') {
                    callback(err, account);
                }
            });
            req.write(data);
            req.end();
        }).on('error', function callbackFromGetTokenWithError(err) {
            if (typeof callback === 'function') {
                callback(err, account);
            }
        });
    };

    this.getPage = function (url, params, callback) {

        if (this.sessionId === null) {
            if (typeof callback === 'function') {
                callback(new Error("Account no has sessionId"), this);
            }
        } else {
            var method = "GET";

            if (typeof params == 'function') {
                 callback = params;
            } else {
                 method="POST";
            }

            var options = {
                hostname: 'the-tale.org',
                port: 80,
                path: url,
                method: method,
                headers: {
                    'Cookie': 'csrftoken=' + this.csrfToken + '; sessionid=' + this.sessionId,
                    'X-CSRFToken': this.csrfToken
                }
            };
            if (typeof params !== 'function') {
                options.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
            } else {
                options.headers['Content-length'] = 0;
            }
            var account = this;

            var req = http.request(options, function sendRequestToHelp(res) {
                var bodyBuffer = null;
                res.on('data', function (chunk){
                    if (bodyBuffer == null) {
                        bodyBuffer = Buffer.concat([chunk]);
                    } else {
                        bodyBuffer = Buffer.concat([bodyBuffer, chunk]);
                    }
                });
                res.on('end', function processHelpRequest() {
                    if (bodyBuffer == null) {
                        callback(null, account, "");
                    } else {
                        callback(null, account, bodyBuffer.toString('utf8'));
                    }
                });
            }).on('error', function errorOnHelp(err) {
                console.log("ERROR");
                console.log(err);
                if (typeof callback === 'function') {
                    callback(err, account)
                }
            });
            if (typeof params !== 'function') {
                req.end(querystring.stringify(params));                 
            } else {
                req.end();
            }
        }
    };

    this.sendMessage = function(accountId, message, callback) {
       if (this.sessionId === null) {
            if (typeof callback === 'function') {
                callback(new Error("Account no has sessionId"), this);
            }
        } else {
            var postData = {
                text: message,
                recipients: accountId
            };
            var options = {
                hostname: 'the-tale.org',
                port: 80,
                path: '/accounts/messages/create?api_client=' + CONST.CLIENT_NAME,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Cookie': 'csrftoken=' + this.csrfToken + '; sessionid=' + this.sessionId,
                    'X-CSRFToken': this.csrfToken
                }
            };
            var account = this;
            var req = http.request(options, function sendRequestToHelp(res) {
                var body = '';
                res.on('data', function (chunk) {
                    body += chunk;
                });
		res.on('end', function(){
                        if (typeof callback === 'function') {
                            callback(body);
                        }
                    }
                );
            }).on('error', function errorOnHelp(err) {
                if (typeof callback === 'function') {
                    callback(err, account);
                }
            });

            req.end(querystring.stringify(postData));
        }
    };
}
