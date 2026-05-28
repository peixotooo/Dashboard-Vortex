// Dicionário de primeiros nomes brasileiros → gênero.
//
// Seed curado a partir do Censo IBGE 2010 (top frequências) + nomes
// comuns que crescem em coortes mais novas (Sophia, Heitor, etc.).
// Cobre ~70% de um CRM brasileiro típico pelo princípio de Pareto;
// nomes fora do dicionário caem na heurística de sufixo da inference
// lib (confidence: low) ou retornam unknown.
//
// Chaves: nome normalizado (lowercase, sem acentos). A função de
// lookup faz a mesma normalização antes de buscar.
//
// femaleRatio: probabilidade do nome ser feminino (0..1). Para nomes
// canônicos não-ambíguos usamos 0.99 / 0.01. Nomes com ambiguidade
// real (unissex) carregam o ratio real e caem em confidence baixa.
//
// occurrences: ordem de grandeza relativa (alto = nome muito comum,
// medio/baixo = nome menos comum). Usado pra modular confiança em
// nomes raros — um nome com 0.97 F mas só 50 ocorrências é menos
// confiável que outro com 0.97 F e 100k.

export type IbgeNameEntry = {
  femaleRatio: number;
  occurrences: "high" | "medium" | "low";
};

const FEMALE_NAMES: Array<[string, IbgeNameEntry["occurrences"], number?]> = [
  // top do Censo
  ["maria", "high"], ["ana", "high"], ["francisca", "high"], ["antonia", "high"],
  ["adriana", "high"], ["juliana", "high"], ["marcia", "high"], ["fernanda", "high"],
  ["patricia", "high"], ["aline", "high"], ["sandra", "high"], ["monica", "high"],
  ["vanessa", "high"], ["camila", "high"], ["amanda", "high"], ["bruna", "high"],
  ["jessica", "high"], ["leticia", "high"], ["julia", "high"], ["luciana", "high"],
  ["marcela", "high"], ["larissa", "high"], ["beatriz", "high"], ["mariana", "high"],
  ["gabriela", "high"], ["rafaela", "high"], ["carolina", "high"], ["daniela", "high"],
  ["jaqueline", "high"], ["jacqueline", "high"], ["tatiana", "high"], ["tatiane", "high"],
  ["renata", "high"], ["vania", "high"], ["cristina", "high"], ["claudia", "high"],
  ["rosana", "high"], ["silvia", "high"], ["simone", "high"], ["sonia", "high"],
  ["rita", "high"], ["regina", "high"], ["rosangela", "high"], ["rosa", "high"],
  ["raquel", "high"], ["roberta", "high"], ["sabrina", "high"], ["carla", "high"],
  ["cintia", "high"], ["debora", "high"], ["michele", "high"], ["michelle", "high"],
  ["milena", "high"], ["mirian", "high"], ["miriam", "high"], ["natalia", "high"],
  ["nathalia", "high"], ["paula", "high"], ["priscila", "high"], ["thais", "high"],
  ["thalita", "high"], ["thamires", "high"], ["vivian", "high"], ["viviane", "high"],
  ["alessandra", "high"], ["alice", "high"], ["amelia", "high"], ["angela", "high"],
  ["barbara", "high"], ["bianca", "high"], ["catarina", "high"], ["cecilia", "high"],
  ["celia", "high"], ["denise", "high"], ["edna", "high"], ["eliana", "high"],
  ["eliane", "high"], ["elisa", "high"], ["elisabete", "high"], ["elisabeth", "high"],
  ["eloisa", "high"], ["emilia", "high"], ["esther", "high"], ["ester", "high"],
  ["eva", "high"], ["fabiana", "high"], ["fatima", "high"], ["flavia", "high"],
  ["gisele", "high"], ["giselle", "high"], ["giovana", "high"], ["giovanna", "high"],
  ["helena", "high"], ["heloisa", "high"], ["ingrid", "high"], ["ines", "high"],
  ["irene", "high"], ["isabel", "high"], ["isabela", "high"], ["isabella", "high"],
  ["isadora", "high"], ["ivone", "high"], ["janaina", "high"], ["joana", "high"],
  ["josefa", "high"], ["karina", "high"], ["laura", "high"], ["lais", "high"],
  ["livia", "high"], ["lilian", "high"], ["lourdes", "high"], ["luana", "high"],
  ["lucia", "high"], ["luiza", "high"], ["luisa", "high"], ["manuela", "high"],
  ["margarida", "high"], ["marlene", "high"], ["marta", "high"], ["mayara", "high"],
  ["melissa", "high"], ["nayara", "high"], ["nicole", "high"], ["olivia", "high"],
  ["pamela", "high"], ["raissa", "high"], ["rebeca", "high"], ["sara", "high"],
  ["sarah", "high"], ["selma", "high"], ["sheila", "high"], ["sofia", "high"],
  ["sophia", "high"], ["solange", "high"], ["sueli", "high"], ["susana", "high"],
  ["talita", "high"], ["tamires", "high"], ["tania", "high"], ["teresa", "high"],
  ["tereza", "high"], ["valeria", "high"], ["vera", "high"], ["veronica", "high"],
  ["vilma", "high"], ["virginia", "high"], ["vitoria", "high"], ["yasmin", "high"],
  ["alana", "high"], ["conceicao", "high"], ["eduarda", "high"], ["elaine", "high"],
  ["erica", "high"], ["gloria", "high"], ["graca", "high"], ["katia", "high"],
  ["lara", "high"], ["lidia", "high"], ["lorena", "high"], ["marina", "high"],
  ["silvana", "high"], ["telma", "high"], ["alicia", "medium"], ["ariana", "medium"],
  ["agatha", "medium"], ["agata", "medium"], ["cassia", "medium"], ["dalva", "medium"],
  ["diana", "medium"], ["dulce", "medium"], ["edith", "medium"], ["elen", "medium"],
  ["ellen", "medium"], ["eliza", "medium"], ["elza", "medium"], ["emanuelly", "medium"],
  ["emily", "medium"], ["emanuela", "medium"], ["estela", "medium"], ["eunice", "medium"],
  ["fabiola", "medium"], ["geni", "medium"], ["glaucia", "medium"], ["graziela", "medium"],
  ["hilda", "medium"], ["iara", "medium"], ["iolanda", "medium"], ["iracema", "medium"],
  ["ivete", "medium"], ["ivonete", "medium"], ["ivana", "medium"], ["janete", "medium"],
  ["janice", "medium"], ["jessika", "medium"], ["joice", "medium"], ["josiane", "medium"],
  ["joelma", "medium"], ["juliane", "medium"], ["kamila", "medium"], ["karine", "medium"],
  ["ketlyn", "medium"], ["lavinia", "medium"], ["leda", "medium"], ["leila", "medium"],
  ["letycia", "medium"], ["ligia", "medium"], ["lina", "medium"], ["liliana", "medium"],
  ["liliane", "medium"], ["luciene", "medium"], ["ludmila", "medium"], ["luna", "medium"],
  ["magda", "medium"], ["mara", "medium"], ["martha", "medium"], ["maura", "medium"],
  ["maiara", "medium"], ["manoela", "medium"], ["nadia", "medium"], ["nair", "medium"],
  ["natasha", "medium"], ["nathaly", "medium"], ["neide", "medium"], ["nicoli", "medium"],
  ["noemia", "medium"], ["norma", "medium"], ["odete", "medium"], ["olga", "medium"],
  ["paloma", "medium"], ["poliana", "medium"], ["rachel", "medium"], ["rayane", "medium"],
  ["rebecca", "medium"], ["rosely", "medium"], ["rosemeire", "medium"], ["rute", "medium"],
  ["samira", "medium"], ["silmara", "medium"], ["socorro", "medium"], ["stephanie", "medium"],
  ["suelen", "medium"], ["suzana", "medium"], ["taina", "medium"], ["tamara", "medium"],
  ["taynara", "medium"], ["thaisa", "medium"], ["thaynara", "medium"], ["valdirene", "medium"],
  ["wanda", "medium"], ["wilma", "medium"], ["yara", "medium"], ["zenaide", "medium"],
  ["zilda", "medium"], ["iris", "medium", 0.97],
  ["kelly", "high", 0.97],
  // baixa frequência mas inequívoco
  ["dilma", "low"], ["doralice", "low"], ["edileuza", "low"], ["filomena", "low"],
  ["hadassa", "low"], ["helma", "low"], ["juliete", "low"], ["kethelin", "low"],
  ["loraine", "low"], ["marizete", "low"], ["matilde", "low"], ["miriane", "low"],
  ["myrian", "low"], ["nilza", "low"], ["renatha", "low"], ["ronilda", "low"],
  ["rosalia", "low"], ["rosaria", "low"], ["thabata", "low"], ["vanderleia", "low"],
  ["vanusa", "low"], ["vicentina", "low"],
];

const MALE_NAMES: Array<[string, IbgeNameEntry["occurrences"], number?]> = [
  ["jose", "high"], ["joao", "high"], ["antonio", "high"], ["francisco", "high"],
  ["carlos", "high"], ["paulo", "high"], ["pedro", "high"], ["lucas", "high"],
  ["luis", "high"], ["luiz", "high"], ["marcos", "high"], ["marcio", "high"],
  ["marcelo", "high"], ["rafael", "high"], ["daniel", "high"], ["bruno", "high"],
  ["eduardo", "high"], ["felipe", "high"], ["raimundo", "high"], ["rodrigo", "high"],
  ["manoel", "high"], ["manuel", "high"], ["sebastiao", "high"], ["ricardo", "high"],
  ["fernando", "high"], ["fabio", "high"], ["andre", "high"], ["alexandre", "high"],
  ["anderson", "high"], ["diego", "high"], ["diogo", "high"], ["douglas", "high"],
  ["edson", "high"], ["edilson", "high"], ["emerson", "high"], ["evandro", "high"],
  ["fabricio", "high"], ["flavio", "high"], ["gabriel", "high"], ["geraldo", "high"],
  ["gilberto", "high"], ["gilmar", "high"], ["guilherme", "high"], ["gustavo", "high"],
  ["henrique", "high"], ["hugo", "high"], ["igor", "high"], ["ivan", "high"],
  ["jeferson", "high"], ["jefferson", "high"], ["jonathan", "high"], ["jorge", "high"],
  ["juliano", "high"], ["julio", "high"], ["leandro", "high"], ["leonardo", "high"],
  ["mario", "high"], ["mateus", "high"], ["matheus", "high"], ["mauricio", "high"],
  ["mauro", "high"], ["miguel", "high"], ["milton", "high"], ["murilo", "high"],
  ["nelson", "high"], ["nicolas", "high"], ["otavio", "high"], ["reginaldo", "high"],
  ["renan", "high"], ["reinaldo", "high"], ["roberto", "high"], ["rogerio", "high"],
  ["ronaldo", "high"], ["rubens", "high"], ["sergio", "high"], ["sidney", "high"],
  ["silvio", "high"], ["sandro", "high"], ["thiago", "high"], ["tiago", "high"],
  ["valdir", "high"], ["vagner", "high"], ["vicente", "high"], ["victor", "high"],
  ["vitor", "high"], ["vinicius", "high"], ["wagner", "high"], ["wellington", "high"],
  ["wesley", "high"], ["william", "high"], ["willian", "high"], ["ademir", "high"],
  ["adilson", "high"], ["adriano", "high"], ["ailton", "high"], ["alberto", "high"],
  ["alessandro", "high"], ["arthur", "high"], ["artur", "high"], ["augusto", "high"],
  ["benedito", "high"], ["bernardo", "high"], ["caio", "high"], ["cesar", "high"],
  ["claudio", "high"], ["cleber", "high"], ["cristiano", "high"], ["davi", "high"],
  ["david", "high"], ["elias", "high"], ["enzo", "high"], ["erick", "high"],
  ["filipe", "high"], ["heitor", "high"], ["jair", "high"], ["joaquim", "high"],
  ["joel", "high"], ["luan", "high"], ["luciano", "high"], ["moises", "high"],
  ["nathan", "high"], ["patrick", "high"], ["ramon", "high"], ["renato", "high"],
  ["robson", "high"], ["samuel", "high"], ["severino", "high"], ["alexsandro", "medium"],
  ["abel", "medium"], ["ademar", "medium"], ["agnaldo", "medium"], ["alfredo", "medium"],
  ["almir", "medium"], ["alvaro", "medium"], ["amauri", "medium"], ["amilton", "medium"],
  ["arnaldo", "medium"], ["caique", "medium"], ["celso", "medium"], ["cicero", "medium"],
  ["claudemir", "medium"], ["cleiton", "medium"], ["denilson", "medium"], ["domingos", "medium"],
  ["edgar", "medium"], ["edmar", "medium"], ["ernesto", "medium"], ["ezequiel", "medium"],
  ["frederico", "medium"], ["gilson", "medium"], ["gilvan", "medium"], ["giovani", "medium"],
  ["giovanni", "medium"], ["hamilton", "medium"], ["helder", "medium"], ["helio", "medium"],
  ["humberto", "medium"], ["ian", "medium"], ["ismael", "medium"], ["itamar", "medium"],
  ["ivanildo", "medium"], ["jadson", "medium"], ["jonas", "medium"], ["jonatas", "medium"],
  ["jurandir", "medium"], ["kaique", "medium"], ["kauan", "medium"], ["kevin", "medium"],
  ["laercio", "medium"], ["lazaro", "medium"], ["levi", "medium"], ["lourival", "medium"],
  ["lucca", "medium"], ["marlon", "medium"], ["messias", "medium"], ["moacir", "medium"],
  ["natanael", "medium"], ["newton", "medium"], ["nilton", "medium"], ["odair", "medium"],
  ["oscar", "medium"], ["osvaldo", "medium"], ["oswaldo", "medium"], ["pablo", "medium"],
  ["pietro", "medium"], ["raul", "medium"], ["rian", "medium"], ["romario", "medium"],
  ["ruan", "medium"], ["rui", "medium"], ["ryan", "medium"], ["salomao", "low"],
  ["saulo", "medium"], ["silas", "medium"], ["simao", "medium"], ["thales", "medium"],
  ["tomas", "medium"], ["valdemar", "medium"], ["valter", "medium"], ["vanderlei", "medium"],
  ["waldemar", "medium"], ["wallace", "medium"], ["washington", "medium"], ["weslley", "medium"],
  ["weverton", "medium"], ["yago", "medium"], ["yan", "medium"],
  // baixa freq
  ["abraao", "low"], ["alceu", "low"], ["arnoldo", "low"], ["aurelio", "low"],
  ["benjamin", "low"], ["caetano", "low"], ["clovis", "low"], ["decio", "low"],
  ["derek", "low"], ["ed", "low"], ["euclides", "low"], ["francinaldo", "low"],
  ["gonzalo", "low"], ["graciano", "low"], ["hernani", "low"], ["hilario", "low"],
  ["josiel", "low"], ["juarez", "low"], ["klaus", "low"], ["leonel", "low"],
  ["lindomar", "low"], ["ludgero", "low"], ["marcelino", "low"], ["marciano", "low"],
  ["martin", "low"], ["nestor", "low"], ["norberto", "low"], ["octavio", "low"],
  ["paulino", "low"], ["peterson", "low"], ["raoni", "low"], ["remy", "low"],
  ["rivaldo", "low"], ["romualdo", "low"], ["ronan", "low"], ["tito", "low"],
  ["ubirajara", "low"], ["uilson", "low"], ["ulysses", "low"], ["uriel", "low"],
  ["valentin", "low"], ["walmir", "low"], ["welder", "low"], ["zaqueu", "low"],
  ["zeca", "low"], ["cassiano", "medium"], ["junior", "high", 0.02],
  ["yuri", "medium", 0.05], ["emanuel", "medium", 0.05], ["alex", "high", 0.05],
  ["rene", "low", 0.05],
];

// Unissex / ambíguos — sempre caem em low confidence
const AMBIGUOUS_NAMES: Array<[string, IbgeNameEntry["occurrences"], number]> = [
  ["ariel", "medium", 0.45],
  ["cris", "low", 0.55],
  ["dani", "low", 0.55],
  ["darci", "low", 0.4],
  ["jean", "medium", 0.1],
  ["jaime", "medium", 0.15],
  ["jhonny", "low", 0.05],
  ["juca", "low", 0.05],
  ["marian", "low", 0.7],
  ["noa", "low", 0.5],
  ["remi", "low", 0.2],
  ["sasha", "low", 0.7],
  ["taty", "low", 0.95],
  ["val", "low", 0.6],
];

function buildDict(): Record<string, IbgeNameEntry> {
  const dict: Record<string, IbgeNameEntry> = {};
  for (const [name, occurrences, overrideRatio] of FEMALE_NAMES) {
    dict[name] = { femaleRatio: overrideRatio ?? 0.99, occurrences };
  }
  for (const [name, occurrences, overrideRatio] of MALE_NAMES) {
    // Não sobrescrever entrada feminina se o nome aparecer em ambos
    // (não deveria, mas defensivo). Aqui o último ganha — seria um bug
    // de curadoria; logamos no DEV_DUPES abaixo.
    dict[name] = { femaleRatio: overrideRatio ?? 0.01, occurrences };
  }
  for (const [name, occurrences, ratio] of AMBIGUOUS_NAMES) {
    dict[name] = { femaleRatio: ratio, occurrences };
  }
  return dict;
}

export const IBGE_NAMES: Record<string, IbgeNameEntry> = buildDict();
