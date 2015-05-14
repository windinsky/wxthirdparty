module.exports = {
	'ComponentSecrets':{
		table: 'component_secrets',
		columns: {
			'ticket' : String,
			'ticket_updated_at' : Number,
			'access_token' : String,
			'access_token_updated_at' : Number,
			'access_token_expires_in' : Number,
			'preauthcode' : String,
			'preauthcode_updated_at' : Number,
			'preauthcode_expires_in' : Number
		}
	}
}
