# Integracion Meta con test number

Este flujo conecta un tenant del panel con un numero de prueba de Meta para validar el webhook de WhatsApp.

1. Crea una app en developers.facebook.com y agrega el producto WhatsApp.
2. Ve a Settings -> Basic, copia el **App Secret** y pegalo en el `.env` del VPS como `META_APP_SECRET`.
3. En WhatsApp -> API Setup, copia el **phone_number_id** y el **access token temporal** de 24 horas. Para una conexion estable, crea un token permanente de System User.
4. En el panel, abre `/tenants/<slug>` y entra al tab WhatsApp.
5. Genera el verify token y copialo.
6. Pega el phone number ID y el access token. Guarda los cambios.
7. Copia la URL del webhook que muestra el panel.
8. En Meta Developer -> WhatsApp -> Configuration -> Webhook, pega la URL del panel como Callback URL y el token del panel como Verify Token.
9. Suscribe el webhook al campo `messages`.
10. Para probar, ve a Meta -> Phone Numbers y agrega el numero personal del tester.
11. Manda un mensaje desde ese numero al test number. El mensaje deberia llegar al webhook del tenant.
