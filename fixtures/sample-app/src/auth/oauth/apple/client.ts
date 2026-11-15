import { buildUrl, callbackUrl, postForm } from '../../../lib'
import { userFromIdToken, type OAuthClient } from '../providers'

type TokenResponse = { access_token: string; id_token: string }

const clientId = process.env.APPLE_SERVICE_ID ?? ''
const clientSecret = process.env.APPLE_CLIENT_SECRET ?? ''

export const appleClient: OAuthClient = {
    authorizeUrl(state) {
        return buildUrl('https://appleid.apple.com/auth/authorize', {
            client_id: clientId,
            redirect_uri: callbackUrl('apple'),
            response_type: 'code',
            response_mode: 'form_post',
            scope: 'name email',
            state,
        })
    },

    async exchangeCode(code) {
        const tokens = await postForm<TokenResponse>('https://appleid.apple.com/auth/token', {
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: callbackUrl('apple'),
        })
        return userFromIdToken(tokens.id_token)
    },
}
