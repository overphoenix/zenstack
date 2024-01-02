import { PluginError, hasAttribute, type PluginFunction } from '@zenstackhq/sdk';
import { isDataModel, type DataModel, type Model } from '@zenstackhq/sdk/ast';
import path from 'path';
import { SyntaxKind, type MethodSignature, Project, type PropertySignature, TypeAliasDeclaration } from 'ts-morph';
import { getDefaultOutputFolder } from '../plugin-utils';
import PrismaSchemaGenerator from './schema-generator';

export const name = 'Prisma';

const run: PluginFunction = async (model, options, _dmmf, globalOptions) => {
    const physicalGenerator = new PrismaSchemaGenerator();
    await physicalGenerator.generate(model, options);

    const defaultOutput = getDefaultOutputFolder(globalOptions);
    if (!defaultOutput) {
        throw new PluginError(name, `Unable to determine default output path, not running plugin`);
    }

    const logicalSchema = path.join(defaultOutput, 'logical.prisma');
    const logicalGenerator = new PrismaSchemaGenerator('logical', path.join(defaultOutput, '.prisma'));
    await logicalGenerator.generate(model, {
        ...options,
        output: logicalSchema,
    });

    await processClientTypes(model, defaultOutput);
};

async function processClientTypes(model: Model, defaultOutput: string) {
    const project = new Project();
    const sf = project.addSourceFileAtPath(path.join(defaultOutput, '.prisma', 'index.d.ts'));

    const delegateModels: [DataModel, DataModel[]][] = [];
    model.declarations
        .filter((d): d is DataModel => isDataModel(d) && hasAttribute(d, '@@delegate'))
        .forEach((dm) => {
            delegateModels.push([
                dm,
                model.declarations.filter(
                    (d): d is DataModel => isDataModel(d) && d.superTypes.some((s) => s.ref === dm)
                ),
            ]);
        });

    const toRemove: (PropertySignature | MethodSignature)[] = [];
    const toReplaceText: [TypeAliasDeclaration, string][] = [];

    sf.getDescendants().forEach((desc) => {
        if (desc.isKind(SyntaxKind.PropertySignature) || desc.isKind(SyntaxKind.MethodSignature)) {
            // remove aux fields
            const name = desc.getName();

            if (name.startsWith('poly_aux_')) {
                // console.log('Removing member:', name, desc.getKindName());
                toRemove.push(desc);
            }
        } else if (desc.isKind(SyntaxKind.TypeAliasDeclaration)) {
            const name = desc.getName();
            delegateModels.forEach(([dm, concreteModels]) => {
                if (name === `$${dm.name}Payload`) {
                    console.log(`Replace ${name} with union of ${concreteModels.map((m) => m.name).join(', ')}`);
                    toReplaceText.push([
                        desc,
                        `export type ${name}<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
        ${concreteModels
            .map((m) => '($' + m.name + "Payload<ExtArgs> & { scalars: { delegatedType: '" + m.name + "' } })")
            .join(' | ')};`,
                    ]);
                } else {
                    const regex = new RegExp(`\\${dm.name}(Unchecked)?(Create|Update).*Input`);
                    if (regex.test(name)) {
                        console.log(`Processing ${name}`);
                        desc.getDescendants().forEach((d) => {
                            if (
                                d.isKind(SyntaxKind.PropertySignature) &&
                                ['create', 'update', 'updateMany', 'upsert', 'connectOrCreate'].includes(d.getName())
                            ) {
                                console.log(`Removing member ${d.getName()} from ${name}`);
                                toRemove.push(d);
                            }
                        });
                    }
                }
            });
        } else if (desc.isKind(SyntaxKind.InterfaceDeclaration)) {
            const name = desc.getName();
            if (delegateModels.map(([dm]) => `${dm.name}Delegate`).includes(name)) {
                const createMethod = desc.getMethod('create');
                if (createMethod) {
                    console.log(`Removing method create from interface ${name}`);
                    toRemove.push(createMethod);
                }
                const upsertMethod = desc.getMethod('upsert');
                if (upsertMethod) {
                    console.log(`Removing method upsert from interface ${name}`);
                    toRemove.push(upsertMethod);
                }
            }
        }
    });

    toRemove.forEach((n) => n.remove());
    toReplaceText.forEach(([node, text]) => node.replaceWithText(text));

    await project.save();
}

export default run;
