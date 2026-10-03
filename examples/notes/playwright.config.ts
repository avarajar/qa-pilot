import { defineQaConfig } from '@qa-pilot/playwright'

// contraseñas de demo, las mismas que usa docker-compose.yml por defecto
process.env.NOTES_ADMIN_PASSWORD ??= 'admin-demo'
process.env.NOTES_USER_PASSWORD ??= 'user-demo'

export default defineQaConfig()
