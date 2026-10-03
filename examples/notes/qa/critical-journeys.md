# Journeys críticos · notes

## J1 · Entrar
Un usuario con la contraseña correcta entra y ve la lista de notas.
Con la contraseña incorrecta ve un error y no entra.
Sin sesión, /notes manda a /login.

## J2 · Solo admin borra
El admin ve "Borrar" en cada nota y puede borrar.
El usuario no ve "Borrar"; si manda el POST a mano recibe 403.
