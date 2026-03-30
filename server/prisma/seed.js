const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const people = [
  { key:'p1',  name:'Arthur Smith',   birth:1910, death:1985, gender:'M' },
  { key:'p2',  name:'Eleanor Grant',  birth:1913, death:1990, gender:'F' },
  { key:'p3',  name:'Thomas Smith',   birth:1935, death:2005, gender:'M' },
  { key:'p4',  name:'Helen Moore',    birth:1938, death:2010, gender:'F' },
  { key:'p5',  name:'Margaret Smith', birth:1937, death:2015, gender:'F' },
  { key:'p6',  name:'George Hill',    birth:1935, death:2000, gender:'M' },
  { key:'p7',  name:'Robert Smith',   birth:1940, death:null, gender:'M' },
  { key:'p8',  name:'Clara West',     birth:1942, death:null, gender:'F' },
  { key:'p9',  name:'James Smith',    birth:1962, death:null, gender:'M' },
  { key:'p10', name:'Laura Chen',     birth:1964, death:null, gender:'F' },
  { key:'p11', name:'Susan Smith',    birth:1965, death:null, gender:'F' },
  { key:'p12', name:'David Park',     birth:1963, death:null, gender:'M' },
  { key:'p13', name:'Anne Hill',      birth:1963, death:null, gender:'F' },
  { key:'p14', name:'Michael Torres', birth:1961, death:null, gender:'M' },
  { key:'p15', name:'Peter Hill',     birth:1966, death:null, gender:'M' },
  { key:'p16', name:'Rachel Adams',   birth:1968, death:null, gender:'F' },
  { key:'p17', name:'Daniel Smith',   birth:1968, death:null, gender:'M' },
  { key:'p18', name:'Emma White',     birth:1970, death:null, gender:'F' },
  { key:'p19', name:'Claire Smith',   birth:1971, death:null, gender:'F' },
  { key:'p20', name:'Noah Brown',     birth:1969, death:null, gender:'M' },
  { key:'p21', name:'Oliver Smith',   birth:1990, death:null, gender:'M' },
  { key:'p22', name:'Sophia Lee',     birth:1992, death:null, gender:'F' },
  { key:'p23', name:'Lily Smith',     birth:1992, death:null, gender:'F' },
  { key:'p24', name:'Ethan Clark',    birth:1990, death:null, gender:'M' },
  { key:'p25', name:'Ryan Torres',    birth:1988, death:null, gender:'M' },
  { key:'p26', name:'Mia Johnson',    birth:1990, death:null, gender:'F' },
  { key:'p27', name:'Zoe Hill',       birth:1994, death:null, gender:'F' },
  { key:'p28', name:'Liam Evans',     birth:1992, death:null, gender:'M' },
  { key:'p29', name:'Max Smith',      birth:1994, death:null, gender:'M' },
  { key:'p30', name:'Isla Gray',      birth:1996, death:null, gender:'F' },
  { key:'p31', name:'Sophie Park',    birth:1993, death:null, gender:'F' },
  { key:'p32', name:'Ben Smith',      birth:2015, death:null, gender:'M' },
  { key:'p33', name:'Ella Smith',     birth:2017, death:null, gender:'F' },
  { key:'p34', name:'Finn Clark',     birth:2016, death:null, gender:'M' },
  { key:'p35', name:'Ava Torres',     birth:2014, death:null, gender:'F' },
  { key:'p36', name:'Leo Torres',     birth:2016, death:null, gender:'M' },
  { key:'p37', name:'Grace Hill',     birth:2018, death:null, gender:'F' },
  { key:'p38', name:'Jack Smith',     birth:2019, death:null, gender:'M' },
];

const couples = [
  { id:'c1',  spouseA:'p1',  spouseB:'p2',  children:['p3','p5','p7']  },
  { id:'c2',  spouseA:'p3',  spouseB:'p4',  children:['p9','p11']      },
  { id:'c3',  spouseA:'p5',  spouseB:'p6',  children:['p13','p15']     },
  { id:'c4',  spouseA:'p7',  spouseB:'p8',  children:['p17','p19']     },
  { id:'c5',  spouseA:'p9',  spouseB:'p10', children:['p21','p23']     },
  { id:'c6',  spouseA:'p11', spouseB:'p12', children:['p31']           },
  { id:'c7',  spouseA:'p13', spouseB:'p14', children:['p25']           },
  { id:'c8',  spouseA:'p15', spouseB:'p16', children:['p27']           },
  { id:'c9',  spouseA:'p17', spouseB:'p18', children:['p29']           },
  { id:'c10', spouseA:'p19', spouseB:'p20', children:[]                },
  { id:'c11', spouseA:'p21', spouseB:'p22', children:['p32','p33']     },
  { id:'c12', spouseA:'p23', spouseB:'p24', children:['p34']           },
  { id:'c13', spouseA:'p25', spouseB:'p26', children:['p35','p36']     },
  { id:'c14', spouseA:'p27', spouseB:'p28', children:['p37']           },
  { id:'c15', spouseA:'p29', spouseB:'p30', children:['p38']           },
];

async function main() {
  console.log('Clearing existing data…');
  await prisma.coupleChild.deleteMany();
  await prisma.couple.deleteMany();
  await prisma.person.deleteMany();

  console.log('Upserting demo tree…');
  await prisma.familyTree.upsert({
    where: { id: 'demo-tree-seed-id' },
    update: {},
    create: { id: 'demo-tree-seed-id', name: 'Demo Tree' },
  });

  console.log('Seeding people…');
  const idMap = {};
  for (const { key, ...data } of people) {
    const p = await prisma.person.create({ data: { ...data, treeId: 'demo-tree-seed-id' } });
    idMap[key] = p.id;
  }

  console.log('Seeding couples…');
  for (const c of couples) {
    const couple = await prisma.couple.create({
      data: { spouseAId: idMap[c.spouseA], spouseBId: idMap[c.spouseB] },
    });
    for (let i = 0; i < c.children.length; i++) {
      await prisma.coupleChild.create({
        data: { coupleId: couple.id, childId: idMap[c.children[i]], sortOrder: i },
      });
    }
  }

  console.log(`Done. Seeded ${people.length} people and ${couples.length} couples.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
