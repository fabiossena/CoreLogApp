# Publicação nas lojas — CoreLog

Guia operacional para colocar o app CoreLog no **Google Play** (teste via
Internal App Sharing e trilhas) e na **App Store** (teste via TestFlight).

Arquivos relacionados:| Arquivo | Conteúdo |
|---|---|
| [`../mobile/README.md`](../mobile/README.md) | arquitetura, execução local e build |
| [`privacy-policy.md`](privacy-policy.md) | modelo de política de privacidade (LGPD/GDPR) |
| [`play-listing.md`](play-listing.md) | textos e metadados do Google Play |
| [`app-store-listing.md`](app-store-listing.md) | textos e metadados da App Store |
| [`release-checklist.md`](release-checklist.md) | checklist acionável de release |

Identificadores já configurados:

| Item | Valor |
|---|---|
| Package Android / Bundle ID iOS | `com.corelog.mobile` |
| Nome exibido | `CoreLog` |
| Android `versionCode` / `versionName` | `android/version.properties` |
| iOS `CURRENT_PROJECT_VERSION` / `MARKETING_VERSION` | Xcode → General (1 / 1.0) |
| AAB assinado | `mobile/android/app/build/outputs/bundle/release/app-release.aab` |

---

## Atalho — testar hoje

**Android (Internal App Sharing, sem revisão):**

1. **Antes de enviar**: troque a URL placeholder em
   `mobile/src/config/production.ts` (`https://api.corelog.example.com`) pela
   URL HTTPS real do CoreLog e regere o AAB.
2. O AAB fica em `mobile/android/app/build/outputs/bundle/release/app-release.aab`.
3. Abra <https://play.google.com/console> → app **CoreLog** →
   **Test and release → Internal app sharing**.
4. **Upload new app bundle** → selecione o AAB → aguarde → **Copy link**.
5. Envie o link para o time; no Android ele abre a Play Store e instala.

**iOS (TestFlight, exige Mac):**

1. No Mac: `cd mobile/ios && pod install`.
2. Xcode → **Any iOS Device → Product → Archive → Distribute App → App Store
   Connect → Upload**.
3. App Store Connect → **TestFlight** → resolva Export Compliance → adicione
   testadores internos (sem revisão) ou externos (Beta App Review).

Detalhes completos nas seções 2 e 4.

---

## 1. Google Play — configuração inicial

1. Crie a conta em <https://play.google.com/console> (US$ 25, taxa única).
2. **Create app**:
   - App name: `CoreLog`
   - Default language: Português (Brasil) ou English (US)
   - App or game: **App**
   - Free or paid: **Free**
   - Declarations: marque as políticas.
3. Confirme o package `com.corelog.mobile` (não pode ser alterado depois).
4. **Play App Signing**: aceite o padrão (Google guarda a chave de distribuição;
   você envia com a upload key em `mobile/android/keystore/`).
5. Preencha **Store listing**, **Data safety**, **Content rating**,
   **Target audience**, **Ads**, **News**, **Privacy policy**.

### 1.1 Store listing

Use os textos de [`play-listing.md`](play-listing.md). Assets mínimos:

- Ícone 512×512 PNG (32-bit, sem transparência)
- Feature graphic 1024×500 PNG/JPEG
- 2–8 screenshots de telefone (mín. 320 px, máx. 3840 px; ratio 16:9 ou 9:16)
- Opcional: screenshots de tablet, vídeo do YouTube
- Descrição curta (até 80 caracteres) e completa (até 4000)
- Categoria: **Maps & Navigation** (ou Business)
- Tags, site, e-mail de suporte

### 1.2 Data safety (respostas esperadas)

| Dado | Coletado | Compartilhado | Finalidade | Vinculado ao usuário | Criptografado em trânsito |
|---|---|---|---|---|---|
| Localização precisa | Sim | Sim (backend CoreLog do cliente) | App functionality | Sim | Sim |
| Localização aproximada | Sim | Sim | App functionality | Sim | Sim |
| Device or other IDs | Sim | Não | App functionality, Analytics | Não | Sim |
| App interactions | Sim | Não | Analytics | Não | Sim |
| Crash logs / diagnostics | Sim (Firebase) | Não | Analytics, Diagnostics | Não | Sim |

- **Exclusão de dados**: informe uma URL/instrução para o cliente solicitar
  exclusão (ex.: `https://corelog.example.com/privacy/delete`).
- Marque que os dados são coletados **em segundo plano** (localização).
- Declare que **não** há venda de dados nem tracking para publicidade.

### 1.3 Declaração de localização em segundo plano

O Play exige uma declaração específica para `ACCESS_BACKGROUND_LOCATION`:

1. **App content → Sensitive permissions → Location**.
2. Explique: “O app é um rastreador de frota; a localização em segundo plano é
   essencial para registrar o trajeto do veículo com o app fechado.”
3. Anexe **vídeo** (ou texto detalhado) mostrando:
   - a tela de permissão “Permitir o tempo todo”;
   - a notificação persistente do serviço em execução;
   - o botão de parar o rastreamento;
   - a política de privacidade e o consentimento.
4. Garanta que a permissão seja solicitada em contexto (não na abertura) e que
   exista uma forma clara de desligar o tracking.

> Rejeições comuns: justificativa genérica, falta de aviso in-app, ausência de
> política de privacidade pública ou uso de localização sem relação com a
> funcionalidade principal.

### 1.4 Classificação e público

- **Content rating**: responda o questionário (provavelmente Livre).
- **Target audience**: 18+ (uso corporativo/frota).
- **Ads**: não contém anúncios.
- **App access**: se houver login, forneça credenciais de teste.

---

## 2. Android — Internal App Sharing (link privado, sem revisão)

Recurso ideal para o time testar sem publicar ao público.

1. Gere o AAB assinado (ver `mobile/README.md`, seção 5):
   ```
   mobile/android/app/build/outputs/bundle/release/app-release.aab
   ```
2. Play Console → app CoreLog → **Test and release → Internal app sharing**.
3. **Upload new app bundle** → selecione o `.aab` → aguarde o processamento.
4. Clique em **Copy link**.
5. Compartilhe o link. No Android, o testador:
   - abre o link com a conta Google;
   - toca em **Install** (abre a Play Store);
   - recebe atualizações ao reenviar o link com um novo AAB.
6. Não há revisão, lista de testadores nem opt-in público.

**Limitações**: o link é privado mas qualquer conta com acesso pode instalar;
não aparece em buscas; não substitui a trilha de teste para produção.

---

## 3. Android — Trilhas de teste

| Trilha | Revisão | Testadores | Uso |
|---|---|---|---|
| **Internal testing** | Não | até 100 (e-mails/Grupos) | QA rápido, atualizações automáticas |
| **Closed testing (alpha)** | Leve | listas/grupos | beta com clientes |
| **Open testing (beta)** | Sim | público | beta aberto |
| **Production** | Sim | público | lançamento |

Passos (internal testing):

1. **Test and release → Testing → Internal testing → Create new release**.
2. Envie o AAB, escreva as release notes, **Save → Review → Start rollout**.
3. **Testers → Create email list** e adicione os e-mails.
4. Envie o **opt-in URL**; o testador aceita e instala.
5. Para atualizar, crie uma nova release com `VERSION_CODE` maior.

**Regra importante**: contas pessoais de desenvolvedor criadas após nov/2023
precisam de **closed testing com 12 testadores ativos por 14 dias** antes de
solicitar acesso à produção.

---

## 4. iOS — App Store Connect e TestFlight

Pré-requisitos: Mac + Xcode 16+, **Apple Developer Program** (US$ 99/ano).

1. **Certificates, Identifiers & Profiles** → registre o App ID
   `com.corelog.mobile`.
2. Habilite capabilities:
   - Background Modes → Location Updates, Remote Notifications
   - Push Notifications (se usar FCM)
3. **App Store Connect → My Apps → + → New App**:
   - Platform: iOS
   - Name: `CoreLog`
   - Primary language, SKU (ex.: `corelog-mobile-001`), bundle id.
4. Preencha **App Privacy** (ver `mobile/README.md`, seção 7.4).
5. Gere o build:
   - Xcode → Any iOS Device → **Product → Archive**;
   - Organizer → **Distribute App → App Store Connect → Upload**;
   - ou use `mobile/ios/ExportOptions.plist.example` + `xcodebuild`/`altool`.
6. **TestFlight**:
   - aguarde o processamento (5–30 min);
   - resolva **Export Compliance** (`ITSAppUsesNonExemptEncryption=false` já
     configurado);
   - **Internal Testing**: até 100 membros da equipe, sem revisão;
   - **External Testing**: até 10.000, primeiro build passa por **Beta App
     Review**;
   - builds expiram em **90 dias**;
   - feedback/crash logs ficam no TestFlight.
7. Produção: **App Store → + Version → Submit for Review**.

### 4.1 Incrementar versão iOS

- `MARKETING_VERSION` (ex.: `1.0.0`) — versão visível.
- `CURRENT_PROJECT_VERSION` (ex.: `2`) — build; **sempre incrementa** para
  cada upload no TestFlight/App Store.

Ajuste em Xcode → target CoreLogMobile → General → Identity, ou no
`project.pbxproj`.

---

## 5. Firebase / push

Necessário apenas para comandos remotos.

**Android**: `mobile/android/app/google-services.json` (ignorado pelo Git). O
plugin é aplicado automaticamente se o arquivo existir.

**iOS**: `mobile/ios/CoreLogMobile/GoogleService-Info.plist` adicionado ao
target no Xcode + APNs Auth Key (`.p8`) no Firebase.

Sem esses arquivos o app compila e o tracking/pânico funcionam; apenas o FCM
fica desativado (o código trata a ausência).

---

## 6. CI/CD (opcional)

O repositório já roda testes no GitHub Actions (`.github/workflows/ci.yml`).
Para release, configure estes secrets:

| Secret | Uso |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 android/keystore/corelog-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | senha do keystore |
| `ANDROID_KEY_ALIAS` | `corelog-upload` |
| `ANDROID_KEY_PASSWORD` | senha da key |
| `GOOGLE_SERVICES_JSON` | conteúdo do `google-services.json` |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` | API key do App Store Connect |
| `APPLE_TEAM_ID` | Team ID |
| `IOS_DISTRIBUTION_CERT_P12` / `IOS_CERT_PASSWORD` | certificado de distribuição |
| `IOS_PROVISIONING_PROFILE` | perfil de provisionamento |

No job Android: decodifique o keystore, grave `keystore.properties`, rode
`./gradlew bundleRelease`. No iOS (runner `macos-14`): instale pods, importe o
certificado no keychain, arquive e envie com `altool`.

---

## 7. Avisos legais e de política

- **Localização em segundo plano** é o ponto mais sensível nas duas lojas.
  Mantenha o aviso in-app, a notificação persistente e a opção de parar.
- A política de privacidade precisa estar **pública e acessível** (GitHub Pages,
  site da empresa, etc.).
- LGPD/GDPR: defina base legal, retenção, direitos do titular e contato do DPO.
- Não use mecanismos para sobreviver à desinstalação (viola Play/Apple).
- TestFlight/Internal App Sharing são para teste; não divulgue os links
  publicamente.
