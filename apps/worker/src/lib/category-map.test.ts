import { describe, expect, it } from 'vitest';
import { matchCategoryByName, matchCategoryByStorePath } from './category-map.ts';

describe('matchCategoryByName', () => {
  it('clasifica pañales y toallitas húmedas en perfumeria/pañales aun sin acentos', () => {
    expect(matchCategoryByName('Panales Babysec Talle Premium 1')).toBe('perfumeria/pañales');
    expect(matchCategoryByName('pañales pampers supersec xxg 24 uds')).toBe('perfumeria/pañales');
    expect(matchCategoryByName('toallitas humedas alnatura 80 uds')).toBe('perfumeria/pañales');
    expect(matchCategoryByName('prepizza x 10 unidades')).toBe('almacen/prepizzas');
  });

  it('no clasifica pan, panificados ni paños como pañales', () => {
    expect(matchCategoryByName('pan lactal blanco 1 kg')).toBe('frescos/panaderia');
    expect(matchCategoryByName('panes de miga premium')).toBe('frescos/panaderia');
    expect(matchCategoryByName('panos algodon estrella')).toBe('limpieza/higiene-del-hogar');
    expect(matchCategoryByName('panuelos pocket x 60')).toBe('limpieza/higiene-del-hogar');
  });

  it('carne y fiambres están separados (jamon/panceta van a fiambres)', () => {
    expect(matchCategoryByName('jamon cocido paleta')).toBe('frescos/fiambres');
    expect(matchCategoryByName('jamon crudo 1 kg')).toBe('frescos/fiambres');
    expect(matchCategoryByName('panceta ahumada')).toBe('frescos/fiambres');
    expect(matchCategoryByName('milanesa de pollo')).toBe('frescos/carnes');
  });

  it('los preparados congelados de pollo no caen en frescos', () => {
    expect(matchCategoryByName('nuggets de pollo crocantes')).toBe(
      'congelados/congelados-preparados',
    );
    expect(matchCategoryByName('patitas pollo cheddar')).toBe('congelados/congelados-preparados');
    expect(matchCategoryByName('formitas pollo sadia')).toBe('congelados/congelados-preparados');
  });

  it('rotisería y panadería son distinguibles', () => {
    expect(matchCategoryByName('roast beef rodaja')).toBe('frescos/carnes');
    expect(matchCategoryByName('rotiseria morfi x porcion')).toBe('frescos/rotiseria');
    expect(matchCategoryByName('grisines malteados')).toBe('frescos/panaderia');
    expect(matchCategoryByName('magdalenas vainilla')).toBe('frescos/panaderia');
    expect(matchCategoryByName('pastelitos de membrillo')).toBe('frescos/panaderia');
  });

  it('alcohol va a limpieza, no a frutas', () => {
    expect(matchCategoryByName('alcohol en gel 70')).toBe('limpieza/higiene-del-hogar');
  });

  it('sin match devuelve almacen (default)', () => {
    expect(matchCategoryByName('malteada quemada premium')).toBe('almacen');
  });

  it('colisiones que generaban regresiones en el retag', () => {
    expect(matchCategoryByName('bocadito chocman black sabor vainilla')).toBe('almacen/chocolates');
    expect(matchCategoryByName('bocadito b-ready nutella')).toBe('almacen/chocolates');
    expect(matchCategoryByName('bocadito de pollo rebosado')).toBe(
      'congelados/congelados-preparados',
    );
    expect(matchCategoryByName('agua micelar rose care nivea')).toBe('perfumeria/cuidado-corporal');
    expect(matchCategoryByName('mousse para el cabello tresemme')).toBe(
      'perfumeria/cuidado-cabello',
    );
    expect(matchCategoryByName('snack para gato whiskas')).toBe('mascotas');
    expect(matchCategoryByName('nuez moscada molida')).toBe('almacen/condimentos');
    expect(matchCategoryByName('merluza en aceite x3')).toBe('almacen/conservas');
    expect(matchCategoryByName('tomate cubeteado san jorge')).toBe('almacen/conservas');
    expect(matchCategoryByName('tomate perita campagnola')).toBe('almacen/conservas');
    expect(matchCategoryByName('huevo rosa kinder 20g')).toBe('almacen/chocolates');
    expect(matchCategoryByName('milanesa de carne rebozada congelada')).toBe(
      'congelados/congelados-preparados',
    );
  });

  it('colisiones del segundo dry-run', () => {
    expect(matchCategoryByName('papas pringles crema cebolla')).toBe('almacen/snacks');
    expect(matchCategoryByName('papas smiles mc cain')).toBe('congelados/congelados-preparados');
    expect(matchCategoryByName('papas tradicionales mccain')).toBe(
      'congelados/congelados-preparados',
    );
    expect(matchCategoryByName('toallitas desinfectantes ayudin')).toBe(
      'limpieza/higiene-del-hogar',
    );
    expect(matchCategoryByName('toallitas desmaquillantes q-soft')).toBe('perfumeria');
    expect(matchCategoryByName('lomito de atun al natural swift')).toBe('almacen/conservas');
    expect(matchCategoryByName('palitos pollo swift congelados')).toBe(
      'congelados/congelados-preparados',
    );
    expect(matchCategoryByName('tomate perita arcor')).toBe('almacen/conservas');
    expect(matchCategoryByName('tomate lc cubeteado cebolla oregano')).toBe('almacen/conservas');
    expect(matchCategoryByName('extracto simple tomate campagnola')).toBe('almacen/conservas');
    expect(matchCategoryByName('merluza puglisi en aceite')).toBe('almacen/conservas');
    expect(matchCategoryByName('milanesa de soja lucchetti')).toBe(
      'congelados/congelados-preparados',
    );
    expect(matchCategoryByName('desodorante glade automatico rep')).toBe(
      'limpieza/higiene-del-hogar',
    );
    expect(matchCategoryByName('pimienton campagnola')).toBe('almacen/condimentos');
    expect(matchCategoryByName('cebolla deshidratada escama')).toBe('almacen/condimentos');
    expect(matchCategoryByName('infusion base cafe arlistan')).toBe('almacen/cafe');
    expect(matchCategoryByName('budin vainilla chips smams')).toBe('frescos/panaderia');
    expect(matchCategoryByName('papa comun 1 kgs')).toBe('frescos/frutas-y-verduras');
    expect(matchCategoryByName('papas mc cain golazo')).toBe('congelados/congelados-preparados');
    expect(matchCategoryByName('milanesa granja del sol napolitana')).toBe(
      'congelados/congelados-preparados',
    );
    expect(matchCategoryByName('toallitas femeninas always')).toBe('perfumeria');
    expect(matchCategoryByName('extracto simple de tomate campagnola')).toBe('almacen/conservas');
    expect(matchCategoryByName('desodorante despertar energia aerosol')).toBe(
      'limpieza/higiene-del-hogar',
    );
  });
});

describe('matchCategoryByStorePath', () => {
  it('el path de pañales no cae en panaderia (bug del substring "pan")', () => {
    expect(matchCategoryByStorePath(['Bebés', 'Pañales'])).toBe('perfumeria/pañales');
    expect(matchCategoryByStorePath(['Pañales'])).toBe('perfumeria/pañales');
    expect(matchCategoryByStorePath(['Bebes', 'Panales y Toallitas'])).toBe('perfumeria/pañales');
  });

  it('respeta panaderia para pan real y panificados', () => {
    expect(matchCategoryByStorePath(['Frescos', 'Panificados'])).toBe('frescos/panaderia');
    expect(matchCategoryByStorePath(['Pan y Panificados'])).toBe('frescos/panaderia');
  });

  it('infusiones no cae en yerba', () => {
    expect(matchCategoryByStorePath(['Almacén', 'Infusiones'])).toBe('almacen/infusiones');
  });

  it('prepizzas van a su categoría, no a harinas', () => {
    expect(matchCategoryByStorePath(['Almacen', 'Prepizzas'])).toBe('almacen/prepizzas');
  });

  it('papeles de limpieza caen en higiene-del-hogar', () => {
    expect(matchCategoryByStorePath(['Limpieza', 'Papeles'])).toBe('limpieza/higiene-del-hogar');
  });

  it('path genérico almacen se mapea a la raíz', () => {
    expect(matchCategoryByStorePath(['almacen'])).toBe('almacen');
  });

  it('paths de electrodomésticos/tecnología se mapean a su categoría', () => {
    expect(matchCategoryByStorePath(['Electrodomésticos'])).toBe('electrodomesticos');
    expect(matchCategoryByStorePath(['Electro', 'Cocina'])).toBe('electrodomesticos');
    expect(matchCategoryByStorePath(['Tecnología', 'Celulares'])).toBe('electrodomesticos');
    expect(matchCategoryByStorePath(['Linea Blanca'])).toBe('electrodomesticos');
    expect(matchCategoryByStorePath(['Electro Hogar'])).toBe('electrodomesticos');
    expect(matchCategoryByStorePath(['Pequeños Electrodomésticos'])).toBe('electrodomesticos');
  });

  it('"hogar" solitario sigue siendo limpieza, no electrodomésticos', () => {
    expect(matchCategoryByStorePath(['Hogar'])).toBe('limpieza');
  });
});

describe('matchCategoryByName - electrodomesticos', () => {
  it('clasifica heladeras, freezers y lavado en electrodomesticos', () => {
    expect(matchCategoryByName('heladera no frost 400lt')).toBe('electrodomesticos');
    expect(matchCategoryByName('freezer horizontal 220lt')).toBe('electrodomesticos');
    expect(matchCategoryByName('lavarropas automatico 8kg')).toBe('electrodomesticos');
    expect(matchCategoryByName('lavavajillas 12 cubiertos')).toBe('electrodomesticos');
    expect(matchCategoryByName('secarropas centrifuga')).toBe('electrodomesticos');
  });

  it('clasifica cocción: anafes, microondas, hornos eléctricos', () => {
    expect(matchCategoryByName('anafe electrico vitroceramico 60cm')).toBe('electrodomesticos');
    expect(matchCategoryByName('microondas 20lt digital')).toBe('electrodomesticos');
    expect(matchCategoryByName('horno electrico 36lt')).toBe('electrodomesticos');
    expect(matchCategoryByName('campana extractora 90cm')).toBe('electrodomesticos');
  });

  it('clasifica pequeños electrodomésticos de cocina', () => {
    expect(matchCategoryByName('licuadora 450w')).toBe('electrodomesticos');
    expect(matchCategoryByName('batidora de mano 250w')).toBe('electrodomesticos');
    expect(matchCategoryByName('minipimer 200w')).toBe('electrodomesticos');
    expect(matchCategoryByName('sandwichera doble')).toBe('electrodomesticos');
    expect(matchCategoryByName('tostadora 4 rebanadas')).toBe('electrodomesticos');
    expect(matchCategoryByName('pava electrica 1.5lt')).toBe('electrodomesticos');
    expect(matchCategoryByName('balanza cocina digital 5kg')).toBe('electrodomesticos');
    expect(matchCategoryByName('freidora de aire 3.5lt')).toBe('electrodomesticos');
    expect(matchCategoryByName('airfryer philco 5lt')).toBe('electrodomesticos');
  });

  it('cafeteras (máquinas) van a electrodomesticos, no a almacen/cafe', () => {
    expect(matchCategoryByName('cafetera express philco')).toBe('electrodomesticos');
    expect(matchCategoryByName('cafetera nespresso inissia')).toBe('electrodomesticos');
    expect(matchCategoryByName('cafetera dolce gusto genio')).toBe('electrodomesticos');
    expect(matchCategoryByName('espresso ariete moderna')).toBe('electrodomesticos');
  });

  it('el café envasado NO va a electrodomesticos', () => {
    expect(matchCategoryByName('cafe molido premium')).toBe('almacen/cafe');
    expect(matchCategoryByName('cafe premium suave')).toBe('almacen/cafe');
    expect(matchCategoryByName('capsulas nespresso x8')).toBe('almacen');
  });

  it('clasifica clima: ventiladores, calefactores, aire acondicionado', () => {
    expect(matchCategoryByName('ventilador de pie')).toBe('electrodomesticos');
    expect(matchCategoryByName('calefactor turbo')).toBe('electrodomesticos');
    expect(matchCategoryByName('aire acondicionado 3000 frigorias')).toBe('electrodomesticos');
    expect(matchCategoryByName('caloventor 2000w')).toBe('electrodomesticos');
  });

  it('clasifica electrónica: tv, tablets, celulares, audio', () => {
    expect(matchCategoryByName('televisor smart 43 pulgadas')).toBe('electrodomesticos');
    expect(matchCategoryByName('apple ipad a16 128gb')).toBe('electrodomesticos');
    expect(matchCategoryByName('celular samsung galaxy a15')).toBe('electrodomesticos');
    expect(matchCategoryByName('parlante bluetooth portatil')).toBe('electrodomesticos');
    expect(matchCategoryByName('auriculares inalambricos tws')).toBe('electrodomesticos');
  });

  it('no clasifica alimentos ni limpieza que contengan palabras parecidas', () => {
    expect(matchCategoryByName('bolsa horno barbacoa')).toBe('almacen');
    expect(matchCategoryByName('bizcochuelo mama cocina')).toBe('almacen');
    expect(matchCategoryByName('pan de campo')).toBe('frescos/panaderia');
  });
});
