import { buildUrl, callbackUrl } from '@lib/url'
import { postForm } from '../../../lib/http'
import { userFromIdToken, type OAuthClient } from '../providers'

type TokenResponse = { access_token: string; id_token: string }

const clientId = process.env.GOOGLE_CLIENT_ID ?? ''
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? ''

export const googleClient: OAuthClient = {
    authorizeUrl(state) {
        return buildUrl('https://accounts.google.com/o/oauth2/v2/auth', {
            client_id: clientId,
            redirect_uri: callbackUrl('google'),
            response_type: 'code',
            scope: 'openid email profile',
            state,
        })
    },

    async exchangeCode(code) {
        const tokens = await postForm<TokenResponse>('https://oauth2.googleapis.com/token', {
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: callbackUrl('google'),
        })
        return userFromIdToken(tokens.id_token)
    },
}
