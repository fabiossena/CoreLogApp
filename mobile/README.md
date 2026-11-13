# CoreLog Mobile — Arquitetura, execução local e publicação nas lojas

App React Native (Android + iOS) do CoreLog: rastreamento de frota em segundo
plano, botão de pânico e comandos remotos. Este documento descreve **o que foi
implementado**, **como rodar localmente** (Android verificado neste ambiente e
iOS em macOS) e **tudo o que precisa ser configurado para publicar** no Google
Play (incluindo Internal App Sharing) e na App Store via TestFlight.

> Documentos relacionados: [`docs/api-contract.md`](../docs/api-contract.md)
> (contrato REST/SignalR/FCM), [`store/`](../store/) (metadados, política de
> privacidade e checklist de publicação) e
> [`tools/mock-corelog`](../tools/mock-corelog/) (backend de contrato para
> desenvolvimento).

---

## 1. O que o app faz

| Recurso | Comportamento |
|---|---|
| **Tracking em segundo plano** | Serviço nativo (Android: foreground service; iOS: CoreLocation background) coleta GPS independentemente do JS, com notificação persistente no Android. |
| **Buffer offline** | SQLite local (`corelog_tracking.db`) guarda posições e pânicos quando não há rede; drenagem automática com backoff e watchdog (WorkManager). |
| **Envio em lote** | `POST /api/tracking/events` com `BATCH_SIZE` posições; o app foi validado enviando a cada ~5 s com lote de 1. |
| **Botão de pânico** | Envia `POST /api/panic` imediatamente (fila de alta prioridade) mesmo com tracking parado ou sem rede. |
| **Comandos remotos (FCM)** | `SET_FREQUENCY`, `SILENCE`, `REACTIVATE`, `REQUEST_IMMEDIATE_POSITION`; cada comando é confirmado com `POST /api/devices/{id}/commands/{commandId}/ack`. |
| **Detecção de desinstalação** | Android: evento `app_remove` do Firebase Analytics → Cloud Function/webhook → CoreLog. iOS: timeout de posições + token FCM inválido (limitação documentada). |
| **UI MVVM** | `HomeScreen` observa `HomeViewModel` (estado observável + comandos), com estados explícitos `idle/loading/success/error`. |

---

## 2. Arquitetura (MVVM + Layered)

```
┌──────────────────────────── PRESENTATION ────────────────────────────┐
│ HomeScreen.tsx ──comandos──▶ HomeViewModel.ts ──estado observável──▶ UI │
│ PanicButton.tsx ─────────────────────────────┘                        │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ use cases
┌──────────────────────────────────▼───────────────────────────────────┐
│ DOMAIN (TypeScript puro, sem React/I/O)                              │
│ entities: Position · PanicEvent · RemoteCommand                       │
│ usecases: StartTracking · StopTracking · SendPanic · HandleRemoteCommand│
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ interfaces (DIP)
┌──────────────────────────────────▼───────────────────────────────────┐
│ DATA                                  │ INFRASTRUCTURE                │
│ LocationRepository                    │ BackgroundServiceBridge       │
│ CommandRepository                     │ CoreLogApiClient (axios+retry)│
│ PositionBuffer (SQLite)               │ FcmCommandReceiver (FCM)      │
│                                       │ InstallationTracker           │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
                     NATIVE BACKGROUND SERVICE
                     Android: Foreground Service + WorkManager
                     iOS: CoreLocation background updates
                     coleta N s ─▶ lote ─▶ POST /api/tracking/events
                     sem rede ─▶ SQLite ─▶ retry com backoff
```

### Estrutura de pastas

```
mobile/
├── src/
│   ├── App.tsx                     # composition root (DI manual)
│   ├── config/
│   │   ├── env.ts                  # loadAppEnv (defaults + env)
│   │   └── dev.ts                  # overrides locais (DEV_ENV_OVERRIDES)
│   ├── domain/
│   │   ├── entities/               # Position, PanicEvent, RemoteCommand
│   │   └── usecases/               # 4 casos de uso
│   ├── data/
│   │   ├── local/PositionBuffer.ts # SQLite do lado JS
│   │   └── repositories/           # LocationRepository, CommandRepository
│   ├── infrastructure/
│   │   ├── background/             # bridge para o serviço nativo
│   │   ├── http/                   # CoreLogApiClient (axios, retry)
│   │   ├── push/                   # FCM foreground/background
│   │   └── analytics/              # InstallationTracker
│   └── presentation/
│       ├── screens/HomeScreen.tsx
│       ├── components/PanicButton.tsx
│       └── viewmodels/HomeViewModel.ts
├── android/
│   └── app/src/main/java/com/corelog/mobile/background/
│       ├── CoreLogLocationService.kt   # foreground service (GPS + flush)
│       ├── CoreLogWorker.kt            # watchdog/drain (WorkManager)
│       ├── CoreLogUploader.kt          # HTTP nativo (HttpURLConnection)
│       ├── TrackingStorage.kt          # SQLite nativo (fila)
│       ├── TrackingConfigStore.kt      # SharedPreferences
│       └── CoreLogBackgroundServiceModule.kt  # NativeModules bridge
├── ios/CoreLogMobile/
│   ├── CoreLogLocationManager.swift
│   ├── CoreLogStore.swift
│   ├── CoreLogBackgroundService.swift
│   ├── CoreLogBackgroundServiceBridge.m
│   ├── Info.plist                      # permissões + background modes
│   └── PrivacyInfo.xcprivacy           # privacy manifest (App Store)
├── android/version.properties          # fonte única de versionCode/Name
├── android/keystore.properties.example # modelo de assinatura release
└── android/keystore/README.md          # como gerar a chave de upload
```

### Decisões e ajustes importantes

- **React Native 0.76.9**, New Architecture (`newArchEnabled=true`), Hermes.
- **Firebase 21.14.0** (não 27): a v27 exige Kotlin 2.1, incompatível com a
  toolchain Kotlin 1.9.25/AGP do RN 0.76.
- **`@bglocation/react-native` removido**: só existem as versões 1.1.x, que
  exigem Kotlin 2.1 + Java 21/compileSdk 36 e quebram o codegen do RN 0.76. O
  `BackgroundServiceBridge` já trata a ausência do helper de permissões; as
  permissões são concedidas pelo sistema/serviço nativo.
- **Correções no Kotlin nativo** para o RN 0.76:
  `ReactContext.emitDeviceEvent` (o `getJavaScriptModule` foi removido),
  `startForeground` direto (sem `ServiceCompat`), `setInitialDelay` no
  WorkManager e defaults do `SharedPreferences.getFloat`.
- **Rede fora da main thread**: o upload do serviço roda em
  `Executors.newSingleThreadExecutor()`. Antes, o `NetworkOnMainThreadException`
  era engolido e o buffer nunca drenava.
- **BroadcastReceiver** registrado com `RECEIVER_NOT_EXPORTED` (obrigatório no
  Android 14+ para broadcasts não-sistema).
- **Build no Windows**: usar `--project-cache-dir=C:\gr\corelog` para evitar o
  lock de caminho longo do Gradle em `.gradle/dependencies-accessors`.

---

## 3. Rodando localmente — Android (Windows, verificado)

### 3.1 Pré-requisitos

| Componente | Versão usada |
|---|---|
| Node.js | 20 (ou 18+) |
| JDK | **Temurin 17** (`JAVA_HOME`) |
| Android Studio | 2026.2+ (opcional, mas facilita o SDK Manager) |
| SDK | Platform **35**, Build-Tools **35.0.0**, NDK **26.1.10909125**, CMake **3.22.1** |
| Emulador | AVD `CoreLog_API35` (`system-images;android-35;google_apis;x86_64`) ou aparelho via USB |

```powershell
# variáveis (User) usadas neste ambiente
[Environment]::SetEnvironmentVariable('JAVA_HOME','C:\Program Files\Eclipse Adoptium\jdk-17.0.21.9-hotspot','User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME',"$env:LOCALAPPDATA\Android\Sdk",'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT',"$env:LOCALAPPDATA\Android\Sdk",'User')
```

Crie `mobile/android/local.properties` (já existe neste checkout, e é ignorado
pelo Git):

```properties
sdk.dir=C\:\\Users\\<seu-usuario>\\AppData\\Local\\Android\\Sdk
```

### 3.2 Backend e configuração

O app fala com o CoreLog. Para desenvolver sem o backend, suba o mock de
contrato na raiz do repositório:

```powershell
node tools/mock-corelog/server.mjs --port 8099
# smoke test opcional:
node tools/mock-corelog/smoke-test.mjs
```

Ajuste `mobile/src/config/dev.ts` (injetado pelo composition root, porque o
React Native bare **não carrega `.env`** automaticamente):
```ts
export const DEV_ENV_OVERRIDES: AppEnvOverrides = {
  coreLogBaseUrl: 'http://10.0.2.2:8099', // emulador → host; backend real: 8090
  vehicleId: 'VEH-001',
  batchSize: 1,
  positionIntervalSeconds: 15,
};
```

Em aparelho físico use o IP da máquina na LAN (ex.: `http://192.168.0.10:8099`).

### 3.3 Metro, emulador e build

```powershell
# 1) emulador (ou conecte um aparelho com depuração USB)
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd CoreLog_API35

# 2) Metro na 8088 (a 8081 pode estar ocupada por outro serviço no Windows)
cd mobile
npx react-native start --port 8088

# 3) redirecione a porta que o app debug usa (8081) para o Metro (8088)
adb reverse tcp:8081 tcp:8088

# 4) build + instalação
cd android
.\gradlew.bat app:installDebug -PreactNativeDevServerPort=8081 `
  --project-cache-dir=C:\gr\corelog --console=plain

# 5) permissões e abertura
adb shell pm grant com.corelog.mobile android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.corelog.mobile android.permission.ACCESS_COARSE_LOCATION
adb shell pm grant com.corelog.mobile android.permission.ACCESS_BACKGROUND_LOCATION
adb shell pm grant com.corelog.mobile android.permission.POST_NOTIFICATIONS
adb shell am start -n com.corelog.mobile/.MainActivity
```

> Alternativa ao `adb reverse`: gravar `debug_http_host` como
> `10.0.2.2:8088` nas preferências do app (usado durante a validação).
> Se o Metro reclamar de arquivos alterados durante `npm install`, reinicie-o
> com `--reset-cache`.

### 3.4 O que validar

- Tela mostra `Tracking: OFF`, botão **Start tracking**, botão **PANIC**.
- **Start tracking** → `Tracking: ON`, buffer offline e “Sampling every 15s”.
- **PANIC** → backend registra `panic created for VEH-001` e a UI mostra
  “Panic sent”.
- Após alguns segundos, `Last successful send` é atualizado e o mock loga
  `ingestion: accepted 1/1 position(s)`.
- Logs nativos úteis:
  ```powershell
  adb logcat -s CoreLogUploader:V CoreLogLocationService:V
  ```

### 3.5 Testes

```powershell
cd mobile
npm test                 # Jest: 36 testes (1 suíte pulada por feature flag)
npm run typecheck        # tsc --noEmit
RUN_BRIDGE_INTEGRATION_TESTS=1 npm test
```

---

## 4. Rodando localmente — iOS (macOS)

> Não é possível compilar/rodar iOS no Windows. Use um Mac (ou CI macOS).

### 4.1 Pré-requisitos

- macOS 14+, **Xcode 16+** com Command Line Tools
- **CocoaPods** (`sudo gem install cocoapods` ou `brew install cocoapods`)
- Node 20, Watchman (recomendado)
- Um Apple ID (gratuito para simulador; pago para aparelho/TestFlight)

### 4.2 Instalação

```bash
cd mobile
npm install
cd ios && pod install && cd ..
```

O `Podfile` já configura `use_frameworks! :linkage => :static` e
`$RNFirebaseAsStaticFramework = true`, exigidos pelo React Native Firebase 21.

### 4.3 Configuração

1. Abra `ios/CoreLogMobile.xcworkspace` no Xcode.
2. Em **Signing & Capabilities**, selecione seu **Team** e confirme o bundle id
   `com.corelog.mobile` (ou registre um novo).
3. Para FCM: baixe o `GoogleService-Info.plist` do Firebase e **adicione ao
   target** `CoreLogMobile` (arraste para o grupo, “Copy items if needed”).
   Sem esse arquivo o app roda, mas push fica desativado.
4. As permissões e background modes já estão no `Info.plist`
   (`NSLocation*UsageDescription`, `UIBackgroundModes = location, fetch,
   remote-notification`).

### 4.4 Rodar

```bash
# terminal 1
npx react-native start --port 8088

# terminal 2 (simulador)
npm run ios -- --simulator "iPhone 16" --port 8088
# ou pelo Xcode: selecione o scheme CoreLogMobile e Run
```

- Simulador não simula background GPS de forma realista. Para validar
  background, use um aparelho físico e escolha **Always** na permissão.
- Para simular posições no simulador: Xcode → Debug → Simulate Location →
  adicione um GPX.
- O `NSAllowsLocalNetworking` já permite HTTP local; em produção use HTTPS.

---

## 5. Build de release Android

### 5.1 Versionamento

Edite `android/version.properties` antes de cada envio:

```properties
VERSION_CODE=2        # sempre incrementa
VERSION_NAME=1.0.1
```

### 5.2 Assinatura

A chave de upload deve ficar em `android/keystore/corelog-upload.jks`, com as
senhas em `android/keystore.properties` (ambos ignorados pelo Git — **nunca os
commite**). Se ainda não existir no seu clone, siga
`android/keystore/README.md` para gerar. Guarde os dois e a senha em um cofre:
perder a upload key exige solicitar reset ao Google Play.

### 5.3 Gerar o AAB

```powershell
cd mobile/android
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.21.9-hotspot"
.\gradlew.bat bundleRelease --project-cache-dir=C:\gr\corelog --console=plain
# saída: app/build/outputs/bundle/release/app-release.aab
```

Ou use o script (verifica pré-requisitos e mostra o caminho):

```powershell
powershell -ExecutionPolicy Bypass -File mobile/scripts/build-android-release.ps1
```

O AAB **não é versionado** (fica em `android/app/build/`). O build de release
usa a URL de `src/config/production.ts`; configure a URL real antes de gerar.

Verifique a assinatura:

```powershell
& "$env:JAVA_HOME\bin\jarsigner.exe" -verify -verbose app\build\outputs\bundle\release\app-release.aab
```

> `minifyEnabled`/`shrinkResources` estão ligados no release e as regras R8
> ficam em `android/app/proguard-rules.pro`.

---

## 6. Publicação de teste — Google Play (Internal App Sharing)

O **Internal App Sharing** é o caminho mais rápido: você envia o AAB, recebe um
link privado e qualquer pessoa com o link instala pela Play Store, **sem
revisão** e **sem precisar habilitar “fontes desconhecidas”**.

### 6.1 Pré-requisitos

- Conta no **Google Play Console** (taxa única de US$ 25).
- O app já criado no Console com o package `com.corelog.mobile` (pode estar
  sem nenhuma versão publicada).
- O AAB assinado da seção 5.

### 6.2 Passo a passo

1. Acesse <https://play.google.com/console> → selecione o app **CoreLog**.
2. Menu lateral → **Testar e lançar** (Test and release) → **Compartilhamento
   interno de apps** (Internal app sharing).
3. Clique em **Enviar novo AAB/APK** (Upload new app bundle) e selecione
   `mobile/android/app/build/outputs/bundle/release/app-release.aab`.
4. Aguarde o processamento e clique em **Copiar link**.
5. Envie o link para os testadores. No Android:
   - abra o link no navegador com a **mesma conta Google**;
   - toque em **Instalar** (a Play Store abre e instala);
   - atualizações futuras: reenvie um AAB novo e compartilhe o link novamente.
6. O link **não expira**, mas só serve para builds enviados pelo Internal App
   Sharing (não é listado na Play Store).

> Observações: o link é acessível a qualquer conta Google que o receba (não há
> lista de testadores). O build é o mesmo que iria para produção; ideal para
> validar assinatura, permissões e upgrades. Não há revisão do Google.

### 6.3 Trilha de teste interno (opcional, com lista de testadores)

Se precisar controlar quem testa e manter atualizações automáticas:

1. **Testar e lançar → Teste interno → Criar nova versão**.
2. Envie o AAB, preencha as notas da versão e **Salvar → Revisar versão →
   Iniciar lançamento**.
3. Em **Testadores**, crie uma lista por e-mail ou Google Group (até 100).
4. Copie o **link de participação** e envie; o testador aceita e instala.
5. Teste interno **não passa por revisão** do Google.

### 6.4 Antes de ir para produção (importante)

- Contas pessoais criadas após nov/2023 precisam de **teste fechado com pelo
  menos 12 testadores por 14 dias** antes de liberar produção.
- Preencha **Data safety**, **classificação de conteúdo**, **público-alvo**,
  **política de privacidade** e a **declaração de localização em segundo
  plano** (vídeo/justificativa mostrando o uso para rastreamento de frota).
- Use **Play App Signing** (o AAB enviado é assinado com a upload key; o Google
  re-assina com a chave de distribuição).

---

## 7. Publicação de teste — iOS (TestFlight)

> Requer **macOS + Xcode** e **Apple Developer Program** (US$ 99/ano).

### 7.1 Preparação no App Store Connect

1. Crie o app em <https://appstoreconnect.apple.com> → **My Apps → + → New App**.
2. Bundle ID: `com.corelog.mobile`; nome **CoreLog**; idioma principal.
3. Em **TestFlight**, preencha **Test Information** (e-mail de contato,
   descrição do beta, URL da política de privacidade).
4. No Apple Developer, habilite no App ID:
   - **Background Modes** (Location Updates, Remote Notifications);
   - **Push Notifications** (se usar FCM);
   - **Location** nas capabilities do Xcode.

### 7.2 Assinatura e build

No Xcode:

1. Selecione **Any iOS Device (arm64)**.
2. **Product → Archive**.
3. No Organizer: **Distribute App → App Store Connect → Upload**.
4. Marque **Upload your app's symbols** e deixe o Xcode gerenciar a assinatura.

Via linha de comando:

```bash
cd mobile/ios
pod install
xcodebuild -workspace CoreLogMobile.xcworkspace -scheme CoreLogMobile \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/CoreLogMobile.xcarchive archive

cp ExportOptions.plist.example ExportOptions.plist   # preencha seu Team ID
xcodebuild -exportArchive -archivePath build/CoreLogMobile.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export

xcrun altool --upload-app -f build/export/CoreLogMobile.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

> Alternativa sem CLI: arraste o `.ipa` para o **Transporter** (Mac App Store).

### 7.3 TestFlight

1. O build aparece em **App Store Connect → TestFlight** após o processamento
   (5–30 min). Resolva o **Export Compliance** (já configuramos
   `ITSAppUsesNonExemptEncryption=false`).
2. **Testadores internos** (até 100 membros da equipe): não passam por revisão.
3. **Testadores externos** (até 10.000): o primeiro build passa por uma
   **Beta App Review** (geralmente < 24 h). Crie grupos, adicione e-mails ou
   links públicos.
4. Cada build expira em **90 dias**; envie novos builds com
   `CURRENT_PROJECT_VERSION` incrementado.
5. Versão do app: `MARKETING_VERSION` (ex.: 1.0.0) e `CURRENT_PROJECT_VERSION`
   (build, sempre incrementa) em **Xcode → General** ou no `project.pbxproj`.

### 7.4 Privacidade (obrigatório)

- `PrivacyInfo.xcprivacy` já declara APIs de motivo obrigatório e os tipos de
  dados coletados (localização precisa/aproximada, device ID, interação).
- Em **App Privacy** no App Store Connect, declare:
  - **Precise Location** — App Functionality; vinculada ao usuário: sim.
  - **Device ID** — App Functionality + Analytics; não vinculada.
  - **Product Interaction** — Analytics; não vinculada.
  - **Tracking**: não.
- A justificativa de localização em background deve ficar clara na descrição e
  na política de privacidade (rastreamento de frota em serviço).

---

## 8. Firebase / FCM (push)

Sem Firebase, tracking e pânico funcionam; só os comandos remotos ficam
desativados.

### Android

1. Crie um projeto no <https://console.firebase.google.com>.
2. Adicione o app Android com package `com.corelog.mobile`.
3. Baixe `google-services.json` e coloque em
   `mobile/android/app/google-services.json` (ignorado pelo Git).
4. O plugin `com.google.gms.google-services` é aplicado automaticamente quando
   o arquivo existe (ver `android/app/build.gradle`).
5. Rebuild: o token FCM é registrado e o CoreLog pode enviar comandos.

### iOS

1. No mesmo projeto Firebase, adicione o app iOS com o bundle id.
2. Baixe `GoogleService-Info.plist` e adicione ao target no Xcode.
3. Em **Project Settings → Cloud Messaging**, faça upload da **APNs Auth Key**
   (`.p8`) do Apple Developer.
4. Habilite **Push Notifications** e **Background Modes → Remote notifications**.

### Formato dos comandos

Mensagens **data-only** (sem `notification`), snake_case:

| `command_type` | Dados extras |
|---|---|
| `SET_FREQUENCY` | `seconds` |
| `SILENCE` | `duration_seconds` |
| `REACTIVATE` | — |
| `REQUEST_IMMEDIATE_POSITION` | — |

Toda mensagem carrega `command_id` e `device_id`; o app confirma com
`POST /api/devices/{deviceId}/commands/{commandId}/ack`.

---

## 9. Configuração e variáveis

| Chave | Onde | Padrão | Uso |
|---|---|---|---|
| `CORELOG_BASE_URL` | `.env` / `dev.ts` | `http://localhost:3000` | REST do CoreLog |
| `FCM_SENDER_ID` | `.env` | — | sender id (informativo) |
| `BATCH_SIZE` | `.env` / `dev.ts` | 10 | posições por POST |
| `POSITION_INTERVAL_SECONDS` | `.env` / `dev.ts` | 60 | intervalo de coleta |
| `VEHICLE_ID` | `.env` / `dev.ts` | `UNBOUND` | veículo desta instalação |

> **Atenção**: React Native bare não carrega `.env` sozinho. Em
> desenvolvimento (`__DEV__ === true`) o composition root (`src/App.tsx`) injeta
> `DEV_ENV_OVERRIDES` de `src/config/dev.ts`; em **release** usa
> `PRODUCTION_ENV_OVERRIDES` de `src/config/production.ts`. **Troque a URL
> `https://api.corelog.example.com` pela URL real (HTTPS) antes de gerar o
> AAB/IPA.** Para produção, o ideal é substituir os overrides por configuração
> remota/registro do dispositivo.

---

## 10. Troubleshooting (problemas reais encontrados)

| Sintoma | Causa / solução |
|---|---|
| `Could not move temporary workspace … dependencies-accessors` | Caminho longo no Windows. Use `--project-cache-dir=C:\gr\corelog` (ou habilite LongPathsEnabled). |
| `Inconsistent JVM-target … 17 vs 21` | Dependência compilada para Java 21. Use Firebase 21 + remova `@bglocation`; build com JDK 17. |
| `Unable to load script` no emulador | Metro não alcançável: porta 8081 ocupada por outro serviço. Rode Metro na 8088 e `adb reverse tcp:8081 tcp:8088` (ou `debug_http_host=10.0.2.2:8088`). |
| Buffer offline só cresce | Upload na main thread (`NetworkOnMainThreadException`). Já corrigido com executor em background. |
| Comando remoto não aplica | Receiver sem `RECEIVER_NOT_EXPORTED` no Android 14+. Já corrigido. |
| `getJavaScriptModule` / `ServiceCompat` / `getFloat` | APIs removidas/alteradas no RN 0.76. Já corrigido. |
| App sem push | Falta `google-services.json` (Android) / `GoogleService-Info.plist` + APNs (iOS). |
| `npm` trava no nvm4w | Use `node "C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js" ...`. |

---

## 11. Checklist rápido antes de enviar

- [ ] `android/version.properties` com `VERSION_CODE` incrementado.
- [ ] `android/keystore.properties` + `.jks` em local seguro (backup!).
- [ ] `npm test` e `npm run typecheck` verdes.
- [ ] AAB assinado gerado e verificado.
- [ ] `google-services.json` presente (se FCM for usado).
- [ ] Política de privacidade publicada em URL pública.
- [ ] Data safety (Play) e App Privacy (Apple) preenchidos.
- [ ] Declaração de localização em segundo plano (Play) e justificativa (Apple).
- [ ] Ícone/splash finais (os atuais são os padrões do template).
- [ ] Teste em aparelho real com permissão **“Permitir o tempo todo”**.
- [ ] Internal App Sharing (Android) e TestFlight interno (iOS) validados.

Detalhes de metadados, textos de loja e checklist completo:
[`store/README.md`](../store/README.md).

---

## Próximos passos

1. **Configurar produção**: trocar `https://api.corelog.example.com` em
   `mobile/src/config/production.ts` pela URL HTTPS real.
2. **Firebase/FCM**: adicionar `google-services.json` (Android) e
   `GoogleService-Info.plist` + APNs (iOS) — ver seção 8.
3. **Backend CoreLog**: implementar `/api/devices`, `/api/panic`,
   `/api/trackers` e o hub `JoinAll`/`PositionReceived` (hoje o mock cobre).
4. **Android**: gerar o AAB e validar com **Internal App Sharing** (seção 6).
5. **iOS**: arquivar no Xcode e validar no **TestFlight** (seção 7).
6. **App simplificado para portfólio**: a versão enxuta (somente MVVM + camadas,
   sem background/FCM/SQLite) está em
   [fabiossena/mvvm-layered-app](https://github.com/fabiossena/mvvm-layered-app)
   e é onde as próximas evoluções do app de posição serão feitas.
