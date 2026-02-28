export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 prose prose-neutral dark:prose-invert">
      <h1>Política de Privacidade</h1>
      <p><strong>Última atualização:</strong> 28 de fevereiro de 2026</p>

      <p>
        A <strong>Vortex Dashboard</strong> (&ldquo;nós&rdquo;, &ldquo;nosso&rdquo;) opera a plataforma de
        gerenciamento de anúncios disponível neste domínio. Esta página descreve como coletamos,
        usamos e protegemos suas informações pessoais.
      </p>

      <h2>1. Dados que coletamos</h2>
      <ul>
        <li><strong>Dados de conta:</strong> nome, e-mail e senha fornecidos no cadastro.</li>
        <li><strong>Dados da Meta (Facebook):</strong> ao conectar sua conta do Meta Ads, acessamos o token de acesso, ID da conta de anúncios, campanhas, conjuntos de anúncios, anúncios e métricas de desempenho, conforme as permissões concedidas.</li>
        <li><strong>Dados de uso:</strong> informações sobre como você interage com a plataforma (páginas visitadas, ações realizadas).</li>
      </ul>

      <h2>2. Como usamos seus dados</h2>
      <ul>
        <li>Exibir e gerenciar suas campanhas de anúncios do Meta Ads.</li>
        <li>Criar, editar e monitorar campanhas, conjuntos de anúncios e anúncios em seu nome.</li>
        <li>Apresentar relatórios e métricas de desempenho.</li>
        <li>Melhorar a experiência e a funcionalidade da plataforma.</li>
      </ul>

      <h2>3. Compartilhamento de dados</h2>
      <p>
        Não vendemos, alugamos ou compartilhamos seus dados pessoais com terceiros, exceto:
      </p>
      <ul>
        <li><strong>Meta Platforms, Inc.:</strong> para executar operações de anúncios via API do Meta Ads, conforme suas instruções.</li>
        <li><strong>Provedores de infraestrutura:</strong> Vercel (hospedagem) e Supabase (banco de dados), que processam dados sob nossos contratos de confidencialidade.</li>
        <li><strong>Obrigação legal:</strong> quando exigido por lei ou ordem judicial.</li>
      </ul>

      <h2>4. Armazenamento e segurança</h2>
      <p>
        Seus tokens de acesso à Meta são armazenados de forma criptografada (AES-256). Utilizamos
        HTTPS em todas as comunicações e seguimos práticas de segurança da indústria para proteger
        seus dados.
      </p>

      <h2>5. Retenção de dados</h2>
      <p>
        Mantemos seus dados enquanto sua conta estiver ativa. Você pode solicitar a exclusão da sua
        conta e de todos os dados associados a qualquer momento entrando em contato conosco.
      </p>

      <h2>6. Seus direitos</h2>
      <p>De acordo com a LGPD (Lei Geral de Proteção de Dados), você tem direito a:</p>
      <ul>
        <li>Acessar seus dados pessoais.</li>
        <li>Corrigir dados incompletos ou desatualizados.</li>
        <li>Solicitar a exclusão dos seus dados.</li>
        <li>Revogar o consentimento a qualquer momento.</li>
        <li>Solicitar a portabilidade dos dados.</li>
      </ul>

      <h2>7. Dados da Meta Platform</h2>
      <p>
        Utilizamos a API do Meta Marketing exclusivamente para gerenciar anúncios em seu nome.
        Não armazenamos dados de usuários finais do Facebook ou Instagram. Os dados acessados
        via API da Meta são usados somente para as funcionalidades da plataforma e não são
        compartilhados com terceiros para fins de marketing.
      </p>

      <h2>8. Exclusão de dados</h2>
      <p>
        Para solicitar a exclusão dos seus dados ou desconectar sua conta do Meta, acesse as
        configurações da plataforma ou entre em contato pelo e-mail abaixo.
      </p>

      <h2>9. Contato</h2>
      <p>
        Para dúvidas sobre esta política ou sobre seus dados pessoais, entre em contato:
      </p>
      <ul>
        <li><strong>E-mail:</strong> contato@vortexdashboard.com.br</li>
      </ul>

      <h2>10. Alterações nesta política</h2>
      <p>
        Podemos atualizar esta política periodicamente. Alterações significativas serão
        comunicadas por e-mail ou pela plataforma.
      </p>
    </div>
  );
}
