// FGN сайт: «/rules» — правила использования. Текст статичный (типовой шаблон, перед публикацией — юристу).
// Слева — оглавление (подсвечивает раздел, который сейчас на экране); на телефоне оглавление скрыто.
import React, { useEffect, useState } from "react";
import { C } from "../components/fgn";

export const RULES_CSS = `
.fs-rules .fs-wrap { position: relative; z-index: 1; padding-top: 64px; padding-bottom: 96px; }
.fs-rules-head { text-align: center; animation: fsFade .35s ease both; }
.fs-rules-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: rgba(196,196,206,.62); }
.fs-rules-head h1 { margin: 22px 0 0; font-size: 46px; line-height: 1.12; font-weight: 800; letter-spacing: -.015em; }
.fs-rules-lead { margin: 18px auto 0; max-width: 480px; font-size: 16px; line-height: 1.6; color: rgba(196,196,206,.8); }
.fs-rules-date { margin-top: 18px; font-size: 13.5px; color: rgba(196,196,206,.62); }
.fs-rules-body { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 112px; margin-top: 64px; }
.fs-rules-toc { position: sticky; top: 28px; align-self: start; display: flex; flex-direction: column; gap: 4px; }
.fs-rules-toc a { display: block; padding: 6px 0; font-size: 14px; line-height: 20px; color: rgba(196,196,206,.62);
  text-decoration: none; transition: color .15s; }
.fs-rules-toc a:hover { color: #fff; }
.fs-rules-toc a.on { color: #fff; }
.fs-rules-text { max-width: 860px; }
.fs-rules-text section { scroll-margin-top: 24px; }
.fs-rules-text section + section { margin-top: 40px; }
.fs-rules-text h2 { margin: 0 0 16px; font-size: 24px; line-height: 1.3; font-weight: 700; letter-spacing: -.005em; color: #fff; }
.fs-rules-text p { margin: 0; font-size: 16px; line-height: 1.75; color: rgba(196,196,206,.8); }
.fs-rules-text p + p, .fs-rules-text p + ul, .fs-rules-text ul + p { margin-top: 16px; }
.fs-rules-text p b { color: #fff; font-weight: 700; }
.fs-rules-text ul { margin: 16px 0 0; padding: 0; list-style: none; }
.fs-rules-text li { position: relative; padding-left: 22px; font-size: 16px; line-height: 1.75; color: rgba(196,196,206,.8); }
.fs-rules-text li::before { content: ""; position: absolute; left: 6px; top: .78em; width: 5px; height: 5px; border-radius: 50%; background: rgba(196,196,206,.7); }
.fs-rules-text a { color: ${C.green}; text-decoration: none; }
.fs-rules-text a:hover { text-decoration: underline; }
.fs-rules-note { margin-top: 72px; font-size: 17px; line-height: 1.6; color: #fff; }
@media (max-width: 860px) {
  .fs-rules .fs-wrap { padding-top: 44px; padding-bottom: 64px; }
  .fs-rules-head h1 { font-size: 32px; }
  .fs-rules-lead { font-size: 15px; }
  .fs-rules-body { display: block; margin-top: 40px; }
  .fs-rules-toc { display: none; }
  .fs-rules-text section + section { margin-top: 32px; }
  .fs-rules-text h2 { font-size: 20px; margin-bottom: 12px; }
  .fs-rules-text p, .fs-rules-text li { font-size: 15px; line-height: 1.7; }
  .fs-rules-note { margin-top: 48px; font-size: 15.5px; }
}
`;

type Block = { p: React.ReactNode } | { ul: React.ReactNode[] };
type Section = { id: string; toc: string; title: string; body: Block[] };

const UPDATED = "22.09.2026";

function sections(email: string): Section[] {
  const mail = <a href={`mailto:${email}`}>{email}</a>;
  return [
    {
      id: "general",
      toc: "Общие положения",
      title: "Общие положения",
      body: [
        { p: "Настоящие Правила регулируют отношения между сервисом FGN («Сервис») и физическим лицом («Пользователь»), использующим приложение FGN и сайт fgn.app." },
        { p: "Используя Сервис, Пользователь подтверждает согласие с настоящими Правилами и Политикой конфиденциальности." },
        { p: "Если вы не согласны с условиями — прекратите использование Сервиса." },
      ],
    },
    {
      id: "subject",
      toc: "Предмет соглашения",
      title: "Предмет соглашения",
      body: [
        { p: "FGN предоставляет программный сервис VPN для защищённого соединения, повышения приватности и доступа к серверам по всему миру." },
        { p: "В подписку входят VPN и обход белых списков: защищённое соединение и доступ при дополнительных сетевых ограничениях." },
        {
          ul: [
            "Защита трафика между устройством и точкой выхода.",
            "Безлимитный объём передаваемых данных.",
            "Доступ к серверам в поддерживаемых странах.",
            "Реферальная программа и система заданий с бонусными днями.",
          ],
        },
      ],
    },
    {
      id: "account",
      toc: "Аккаунт пользователя",
      title: "Регистрация и аккаунт",
      body: [
        { p: "Для использования Сервиса требуется аккаунт с email и паролем. Доступ к кабинету — единый для сайта и приложения." },
        { p: "Пользователь обязуется предоставлять достоверные данные, хранить пароль в тайне и не передавать аккаунт третьим лицам." },
        { p: "Все действия, совершённые под вашим логином, считаются вашими. При компрометации немедленно смените пароль и уведомьте поддержку." },
      ],
    },
    {
      id: "payment",
      toc: "Оплата и возвраты",
      title: "Тарифы, оплата и возврат",
      body: [
        { p: "Подписка оформляется на 1, 3 или 12 месяцев. Цена указывается на странице тарифов до оформления." },
        { p: "Оплата происходит через подключённый платёжный шлюз. На MVP-этапе оплата может быть временно отключена — тогда аккаунт создаётся, а привязка тарифа выполняется вручную." },
        {
          ul: [
            "Возврат возможен в течение 3 дней с момента оплаты, если объём использованного трафика ниже 10 ГБ.",
            "Бонусные дни за задания и реферальные начисления не конвертируются в деньги.",
          ],
        },
      ],
    },
    {
      id: "duties",
      toc: "Права и обязанности",
      title: "Права и обязанности сторон",
      body: [
        {
          p: (
            <>
              <b>Сервис обязуется:</b> обеспечивать доступность инфраструктуры, не вести логи посещаемых ресурсов, уведомлять о технических работах в приложении.
            </>
          ),
        },
        {
          p: (
            <>
              <b>Пользователь обязуется:</b> соблюдать законодательство своей юрисдикции, не использовать сервис для массовой рассылки, сканирования сетей или нарушения прав третьих лиц.
            </>
          ),
        },
      ],
    },
    {
      id: "limits",
      toc: "Ограничения",
      title: "Ограничения использования",
      body: [
        { p: "Запрещено использовать Сервис для деятельности, нарушающей закон или настоящие Правила. Пользователь несёт ответственность за соблюдение законодательства своей юрисдикции." },
        {
          ul: [
            "Не перепродавать и не делить аккаунт с неограниченным кругом лиц.",
            "Не создавать автоматизированные бот-сети на базе наших серверов.",
            "Не обходить ограничения на уровне конечного ресурса, если это нарушает условия его использования.",
          ],
        },
      ],
    },
    {
      id: "privacy",
      toc: "Конфиденциальность",
      title: "Обработка персональных данных",
      body: [
        { p: "Собираются только данные, необходимые для работы Сервиса: email, метрики подключения и диагностика сбоев." },
        { p: "История посещаемых страниц, содержание трафика и исходные IP-адреса в логах не сохраняются." },
        { p: <>Данные могут быть удалены по запросу на {mail} в течение 14 дней.</> },
      ],
    },
    {
      id: "liability",
      toc: "Ответственность",
      title: "Ответственность",
      body: [
        { p: "Сервис предоставляется «как есть». Мы не гарантируем 100% бесперебойный доступ, но делаем всё для стабильной работы." },
        { p: "Максимальная ответственность ограничена суммой последнего оплаченного периода." },
      ],
    },
    {
      id: "changes",
      toc: "Изменение условий",
      title: "Изменение условий",
      body: [
        { p: "Мы можем обновлять настоящие Правила. Актуальная версия всегда опубликована на этой странице." },
        { p: "Существенные изменения дополнительно публикуются в приложении. Продолжение использования после изменения означает согласие." },
      ],
    },
    {
      id: "contacts",
      toc: "Контакты",
      title: "Контакты и реквизиты",
      body: [
        { p: <>Поддержка: {mail}</> },
        { p: "По вопросам оплаты и возвратов — тема письма «Оплата / возврат», укажите email аккаунта." },
      ],
    },
  ];
}

export default function SiteRules({ email }: { email: string }) {
  const list = sections(email);
  const [active, setActive] = useState(list[0].id);

  // подсветка текущего раздела в оглавлении
  useEffect(() => {
    const onScroll = () => {
      let cur = list[0].id;
      for (const s of list) {
        const el = document.getElementById(`r-${s.id}`);
        if (el && el.getBoundingClientRect().top <= 140) cur = s.id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = list[list.length - 1].id;
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(`r-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="fs-rules">
      <div className="fs-wrap">
        <div className="fs-rules-head">
          <div className="fs-rules-eyebrow">FGN</div>
          <h1>Правила использования</h1>
          <p className="fs-rules-lead">Нейтральный типовой текст. Перед публикацией должен быть проверен юристом.</p>
          <div className="fs-rules-date">Обновлено: {UPDATED}</div>
        </div>

        <div className="fs-rules-body">
          <nav className="fs-rules-toc" aria-label="Содержание">
            {list.map((s, i) => (
              <a key={s.id} href={`#r-${s.id}`} className={active === s.id ? "on" : undefined} onClick={jump(s.id)}>
                {i + 1}. {s.toc}
              </a>
            ))}
          </nav>

          <div className="fs-rules-text">
            {list.map((s, i) => (
              <section key={s.id} id={`r-${s.id}`}>
                <h2>
                  {i + 1}. {s.title}
                </h2>
                {s.body.map((b, j) =>
                  "ul" in b ? (
                    <ul key={j}>
                      {b.ul.map((li, k) => (
                        <li key={k}>{li}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={j}>{b.p}</p>
                  ),
                )}
              </section>
            ))}
            <p className="fs-rules-note">Данный текст является типовым шаблоном и должен быть проверен юристом перед публикацией.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
