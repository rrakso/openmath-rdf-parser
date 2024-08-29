import { MathNode, parse as mathParse } from 'mathjs';
import { OperatorDictionary } from './OperatorDictionary';
import { BlankNode, DataFactory, NamedNode, Quad, Store, Term, Writer } from 'n3';
import { PrefixedFormula } from './Formula';
import { IriVariableDictionary } from './IriVariableMap';
import { QuadsAndPrefixes } from 'Quand';
const { literal, blankNode, namedNode } = DataFactory;

// Define base IRI
const baseIri = 'http://example.org/ontology#'; //TODO: Allow passing in base IRI

// Define some shorthands for needed properties and classes
const rdfType = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const omApplication = namedNode('http://openmath.org/vocab/math#Application');
const omArguments = namedNode('http://openmath.org/vocab/math#arguments');
const omOperator = namedNode('http://openmath.org/vocab/math#operator');
const omVariable = namedNode('http://openmath.org/vocab/math#Variable');
const omLiteral = namedNode('http://openmath.org/vocab/math#Literal');
const omVariableName = namedNode('http://openmath.org/vocab/math#name');
const omLiteralValue = namedNode('http://openmath.org/vocab/math#value');

/**
 * Convert a mathematical expression from a string to an OpenMath RDF quads and prefixes
 * @param formula A mathematical formula represented in string syntax
 * @returns
 */
export function toOpenMathQuadsAndPrefixes(prefixedFormula: PrefixedFormula | string): QuadsAndPrefixes {
	IriVariableDictionary.reset();

	const prefixes: Record<string, string> = {
		m: 'http://openmath.org/vocab/math#',
	};
	let formula: string;

	if (Object.hasOwn(prefixedFormula as PrefixedFormula, 'prefixes')) {
		for (const [key, value] of (prefixedFormula as PrefixedFormula).prefixes.entries()) {
			console.log(key, value);
			prefixes[key] = value;
		}
		formula = resolvePrefixes(prefixedFormula as PrefixedFormula);
	} else {
		formula = prefixedFormula as string;
	}

	formula = replaceIris(formula);

	// Parse the textual formula into a math.js representation
	const node = mathParse(formula);

	// Create a new RDF store to hold the quads
	const quadsStore = new Store();

	// Map the parsed math.js node structure
	mapToRdf(node, quadsStore);

	const quads: Quad[] = quadsStore.getQuads(
    null as Term | null, // Subject: OTerm (object term)
    null as Term | null, // Predicate: OTerm
    null as Term | null, // Object: OTerm | OTerm[]
    null as Term | null, // Graph: OTerm
	);

	return { quads, prefixes };
}

/**
 * Convert a mathematical expression from a string to an OpenMath RDF object
 * @param formula A mathematical formula represented in string syntax
 * @returns 
 */
export async function toOpenMath(prefixedFormula: PrefixedFormula | string): Promise<string> {
	const { quads, prefixes } = toOpenMathQuadsAndPrefixes(prefixedFormula);

	// Add open-math prefix and user-defined prefixes to the writer
	const writer = new Writer({
		prefixes,
	});
	writer.addQuads(quads);

	// serialize to ttl
	return serializeWriter(writer);
}

function mapToRdf(node: MathNode, quadsStore: Store): NamedNode | BlankNode {
	switch (node.type) {
	case 'ConstantNode': {
		const castNode = node as math.ConstantNode;
		const nodeValue = castNode.value;
		const rdfSymbolNode = blankNode();
		const typeTriple = new Quad(rdfSymbolNode, rdfType, omLiteral);
		const valueTriple = new Quad(rdfSymbolNode, omLiteralValue, literal(nodeValue));
		quadsStore.addQuads([typeTriple, valueTriple]);
		return rdfSymbolNode;
	}
	case 'SymbolNode': {
		const castNode = node as math.SymbolNode;
		const nodeName = castNode.name;
		let rdfSymbolNode: Term;
		if (IriVariableDictionary.containsVariable(nodeName)) {
			const iriOfVariable = IriVariableDictionary.getIriForVariable(nodeName);
			rdfSymbolNode = namedNode(iriOfVariable);
		} else {
			rdfSymbolNode = blankNode();
		}
		const typeTriple = new Quad(rdfSymbolNode, rdfType, omVariable);
		const nameTriple = new Quad(rdfSymbolNode, omVariableName, literal(nodeName));
		quadsStore.addQuads([typeTriple, nameTriple]);
		return rdfSymbolNode;
	}
	case 'AssignmentNode': {
		const castNode = node as math.AssignmentNode;
		const rdfOperator = namedNode(OperatorDictionary.getOpenMathSymbol('='));
		const application = namedNode(`${baseIri}${crypto.randomUUID()}_eq`);
		quadsStore.addQuad(application, rdfType, omApplication);
		quadsStore.addQuad(application, omOperator, rdfOperator);

		// add arguments for each arg
		const argumentList = new Array<NamedNode | BlankNode>();
		// map object and value (left and right side of equation) and add it to the list
		const mappedObject = mapToRdf(castNode.object, quadsStore);
		argumentList.push(mappedObject);
		const mappedValue = mapToRdf(castNode.value, quadsStore);
		argumentList.push(mappedValue);
		const argumentRdfList = new Writer().list(argumentList);
		quadsStore.addQuad(application, omArguments, argumentRdfList);
		return application;
	}
	case 'OperatorNode': {
		const castNode = node as math.OperatorNode;
		const operator = castNode.op;
		const rdfOperator = namedNode(OperatorDictionary.getOpenMathSymbol(operator));
		const application = namedNode<string>(`${baseIri}${crypto.randomUUID()}_${castNode.fn}`);
		quadsStore.addQuad(application, rdfType, omApplication);
		quadsStore.addQuad(application, omOperator, rdfOperator);

		// add arguments for each arg
		const argumentList = new Array<NamedNode | BlankNode>();
		castNode.args.forEach((argument) => {
			// map the argument and add it to the list
			const mappedArgument = mapToRdf(argument, quadsStore);
			argumentList.push(mappedArgument);
		});
		const argumentRdfList = new Writer().list(argumentList);
		quadsStore.addQuad(application, omArguments, argumentRdfList);
		return application;
	}
	case 'FunctionNode': {
		const castNode = node as math.FunctionNode;
		const operator = castNode.fn.name;
		const rdfOperator = namedNode(OperatorDictionary.getOpenMathSymbol(operator));
		const application = namedNode(`${baseIri}${crypto.randomUUID()}_${castNode.fn}`) as NamedNode;
		quadsStore.addQuad(application, rdfType, omApplication);
		quadsStore.addQuad(application, omOperator, rdfOperator);

		// add arguments for each arg
		const argumentList = new Array<NamedNode | BlankNode>();
		castNode.args.forEach((argument) => {
			// map the argument and add it to the list
			const mappedArgument = mapToRdf(argument, quadsStore);
			argumentList.push(mappedArgument);
		});
		const argumentRdfList = new Writer().list(argumentList);
		quadsStore.addQuad(application, omArguments, argumentRdfList);
		// writer.addQuad(application, omArguments, literal(operator));
		return application;
	}
	default:
		throw new Error('Type not handled');
	}
}

/**
 * Replaces all prefixes in a formula
 * @param prefixedFormula Formula with prefix definition
 * @returns Prefix-free formula with full IRIs
 */
export function resolvePrefixes(prefixedFormula: PrefixedFormula): string {
	const formula = prefixedFormula.formula;
	const prefixes = prefixedFormula.prefixes;

	let match;
	let resolvedFormula = formula;
	const regex = /((\w*):)[^//][a-zA-Z-_]*/g;
	while ((match = regex.exec(formula)) !== null) {
		const prefixFound = match[2];
		const prefixWithColon = match[1];
		if (prefixes.has(prefixFound)) {
			const iri = prefixes.get(prefixFound) as string;
			resolvedFormula = resolvedFormula.replace(prefixWithColon, iri);
		} else {
			throw new Error(`The prefix ${match[2]} is not defined!`);
		}
	}

	return resolvedFormula;
}

/**
 * Replaces all IRIs with variables and keeps track of the mapping to re-translate it
 * @param formula
 * @returns
 */
export function replaceIris(formula: string): string {
	const regex = /https?:[/]{2}[a-zA-Z.\-_/#0-9]*/g; // pretty naive regex for IRIs
	let match;
	let formulaWithIrisReplaced = formula;
	while ((match = regex.exec(formula)) !== null) {
		const iriFound = match[0];
		const variableForIri = IriVariableDictionary.addNewIri(iriFound);
		formulaWithIrisReplaced = formulaWithIrisReplaced.replace(iriFound, variableForIri);
	}

	return formulaWithIrisReplaced;
}

/**
 * Wraps the end() function of the N3 writer class so that a Promise and async / await can be used
 * @param writer The writer to serialize data from
 * @returns Promise<string> containing the serialized writer content
 */
async function serializeWriter(writer: Writer): Promise<string> {
	return new Promise((resolve, reject) => {
		writer.end((error, result) => {
			if (error) {
				reject(error);
			} else {
				resolve(result);
			}
		});
	});
}
