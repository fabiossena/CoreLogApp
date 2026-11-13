# Checklist de release — CoreLog Mobile

Use este checklist antes de cada envio para teste ou produção.

## 1. Código e testes

- [ ] `cd mobile && npm test` — todos os testes verdes.
- [ ] `cd mobile && npm run typecheck` — sem erros.
- [ ] `cd web && npm test` — dashboard verde (se o release incluir web).
- [ ] Testado em **aparelho real** (não só emulador), com tela bloqueada.
- [ ] Permissão de localização **“Permitir o tempo todo”** validada.
- [ ] Tracking para/inicia corretamente; notificação persistente aparece/some.
- [ ] Pânico funciona online e offline (buffer drena ao reconectar).
- [ ] Comandos remotos FCM aplicados e confirmados (ack).
- [ ] Consumo de bateria aceitável no intervalo padrão.

## 2. Versão

- [ ] Android: `android/version.properties` com `VERSION_CODE` **incrementado**
      e `VERSION_NAME` atualizado.
- [ ] iOS: `CURRENT_PROJECT_VERSION` incrementado e `MARKETING_VERSION`
      atualizado.
- [ ] Notas da versão escritas (`store/play-listing.md` / TestFlight).

## 3. Assinatura e build

- [ ] `android/keystore.properties` + `.jks` presentes e com **backup seguro**.
- [ ] AAB gerado:
      `mobile/android/app/build/outputs/bundle/release/app-release.aab`.
- [ ] Assinatura verificada (`jarsigner -verify`).
- [ ] iOS: `pod install` sem erros e archive gerado no Xcode.
- [ ] `GoogleService-Info.plist` adicionado ao target (se push for usado).
- [ ] `google-services.json` presente em `android/app/` (se push for usado).

## 4. Configuração de backend

- [ ] `coreLogBaseUrl` de produção (HTTPS), **não** `10.0.2.2`/`localhost`.
- [ ] Endpoints do contrato disponíveis e autenticados.
- [ ] Certificado TLS válido (sem `NSAllowsArbitraryLoads` / cleartext em
      produção).
- [ ] FCM configurado (Android + APNs no iOS) e testado.

## 5. Google Play

- [ ] App criado no Play Console com package `com.corelog.mobile`.
- [ ] Play App Signing aceito.
- [ ] Ficha da loja completa (ícone 512², feature graphic, screenshots, textos).
- [ ] **Data safety** preenchido (localização, device ID, interações,
      diagnósticos).
- [ ] **Content rating** concluído.
- [ ] **Público-alvo**, **anúncios** e **notícias** respondidos.
- [ ] **Política de privacidade** pública e acessível.
- [ ] **Declaração de localização em segundo plano** enviada com vídeo.
- [ ] **Internal App Sharing** testado com o AAB final.
- [ ] Teste interno/fechado com testadores (12 testadores/14 dias se conta
      pessoal nova).
- [ ] Revisão de produção solicitada.

## 6. App Store / TestFlight

- [ ] App ID `com.corelog.mobile` com Background Modes + Push Notifications.
- [ ] App criado no App Store Connect.
- [ ] **App Privacy** preenchido igual ao `PrivacyInfo.xcprivacy`.
- [ ] Export compliance resolvido (`ITSAppUsesNonExemptEncryption=false`).
- [ ] Build enviado e processado no TestFlight.
- [ ] Testadores internos validaram; beta externo revisado (se aplicável).
- [ ] Screenshots e textos da App Store preenchidos.
- [ ] Build de produção submetido para revisão.

## 7. Pós-release

- [ ] Monitorar crashes (Firebase Crashlytics/TestFlight) e avaliações.
- [ ] Verificar taxa de sucesso de ingestão e fila offline no backend.
- [ ] Confirmar que builds antigos do TestFlight expiram em 90 dias.
- [ ] Arquivar o AAB/IPA e as notas da versão.
- [ ] Rotacionar/guardar credenciais e chaves com segurança.
