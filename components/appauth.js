var Steam = require('steam-client');
var SteamUser = require('../index.js');
var ByteBuffer = require('bytebuffer');
var SteamID = require('steamid');
var Helpers = require('./helpers.js');
var SteamCrypto = require('@doctormckay/steam-crypto');

SteamUser.prototype.getAuthSessionTicket = function(appid, callback) {
	this._send(Steam.EMsg.ClientGetAppOwnershipTicket, {"app_id": appid}, function(body) {
		if (body.eresult != Steam.EResult.OK) {
			callback(new Error("Error " + body.eresult));
			return;
		}

		if (body.app_id != appid) {
			callback(new Error("Cannot get app ticket"));
			return;
		}

		// This actually isn't enough. We need connect tokens also. The actual value the Steam API returns is:
		// 1. 64-bit SteamID
		// 2. Length-prefixed GCTOKEN
		// 3. Length-prefixed SESSIONHEADER
		// 4. Length-prefixed OWNERSHIPTICKET (yes, even though the ticket itself has a length)
		// The GCTOKEN and SESSIONHEADER portion is passed to ClientAuthList for reuse validation
		callback(null, body.ticket.toBuffer());
	});
};

SteamUser.prototype.getAppOwnershipTicket = function(appid, callback) {
	this._send(Steam.EMsg.ClientGetAppOwnershipTicket, {"app_id": appid}, function(body) {
		if (body.eresult != Steam.EResult.OK) {
			callback(Helpers.eresultError(body.eresult));
			return;
		}

		if (body.app_id != appid) {
			callback(new Error("Cannot get app ownership ticket"));
			return;
		}

		callback(null, body.ticket.toBuffer());
	});
};

SteamUser.prototype.parseAppTicket = function(ticket) {
	if (!ByteBuffer.isByteBuffer(ticket)) {
		ticket = ByteBuffer.wrap(ticket, ByteBuffer.LITTLE_ENDIAN);
	}

	var details = {};

	try {
		// TODO: Leading SteamID, GCTOKEN, and SESSIONHEADER

		var ticketLength = ticket.readUint32();
		if (ticket.offset - 4 + ticketLength != ticket.limit && ticket.offset - 4 + ticketLength + 128 != ticket.limit) {
			console.log("Bad length: " + ticketLength + " vs " + ticket.limit);
			return null;
		}

		var i, j, dlc;

		details.version = ticket.readUint32();
		details.steamID = new SteamID(ticket.readUint64().toString());
		details.appID = ticket.readUint32();
		details.externalIP = Helpers.ipIntToString(ticket.readUint32());
		details.internalIP = Helpers.ipIntToString(ticket.readUint32());
		details.ownershipFlags = ticket.readUint32();
		details.generated = new Date(ticket.readUint32() * 1000);
		details.expires = new Date(ticket.readUint32() * 1000);
		details.licenses = [];
		
		var licenseCount = ticket.readUint16();
		for (i = 0; i < licenseCount; i++) {
			details.licenses.push(ticket.readUint32());
		}
		
		details.dlc = [];
		
		var dlcCount = ticket.readUint16();
		for (i = 0; i < dlcCount; i++) {
			dlc = {};
			dlc.appID = ticket.readUint32();
			dlc.licenses = [];
			
			licenseCount = ticket.readUint16();
			
			for (j = 0; j < licenseCount; j++) {
				dlc.licenses.push(readUint32());
			}
			
			details.dlc.push(dlc);
		}
		
		ticket.readUint16(); // reserved
		if (ticket.offset + 128 == ticket.limit) {
			// Has signature
			details.signature = ticket.slice(ticket.offset, ticket.offset + 128).toBuffer();
		}

		var date = new Date();
		details.expired = details.generated > date || date > details.expires;
		details.validSignature = details.signature && SteamCrypto.verifySignature(ticket.slice(0, ticketLength).toBuffer(), details.signature);
		details.isValid = !details.expired && (!details.signature || details.validSignature);
	} catch (ex) {
		console.log(ex);
		return null; // not a valid ticket
	}

	return details;
};
