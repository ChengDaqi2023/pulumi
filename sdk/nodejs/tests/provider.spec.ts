// Copyright 2016-2021, Pulumi Corporation.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as assert from "assert";

import * as pulumi from "..";
import * as internals from "../provider/internals";

const gstruct = require("google-protobuf/google/protobuf/struct_pb.js");

class TestResource extends pulumi.CustomResource {
    constructor(name: string, opts?: pulumi.CustomResourceOptions) {
        super("test:index:TestResource", name, {}, opts);
    }
}

class TestModule implements pulumi.runtime.ResourceModule {
    construct(name: string, type: string, urn: string): pulumi.Resource {
        switch (type) {
            case "test:index:TestResource":
                return new TestResource(name, { urn });
            default:
                throw new Error(`unknown resource type ${type}`);
        }
    }
}

class TestMocks implements pulumi.runtime.Mocks {
    call(args: pulumi.runtime.MockCallArgs): Record<string, any> {
        throw new Error(`unknown function ${args.token}`);
    }

    newResource(args: pulumi.runtime.MockResourceArgs): { id: string | undefined; state: Record<string, any> } {
        return {
            id: args.name + "_id",
            state: args.inputs,
        };
    }
}

describe("provider", () => {
    it("parses arguments generated by --logflow", async () => {
        const parsedArgs = internals.parseArgs([
            "--logtostderr",
            "-v=9",
            "--tracing",
            "127.0.0.1:6007",
            "127.0.0.1:12345",
        ]);
        if (parsedArgs !== undefined) {
            assert.strictEqual("127.0.0.1:12345", parsedArgs.engineAddress);
        } else {
            assert.fail("failed to parse");
        }
    });

    describe("deserializeInputs", () => {
        beforeEach(() => {
            pulumi.runtime._reset();
            pulumi.runtime._resetResourcePackages();
            pulumi.runtime._resetResourceModules();
        });

        async function assertOutputEqual(
            actual: any,
            value: ((v: any) => Promise<void>) | any,
            known: boolean,
            secret: boolean,
            deps?: pulumi.URN[],
        ) {
            assert.ok(pulumi.Output.isInstance(actual));

            if (typeof value === "function") {
                await value(await actual.promise());
            } else {
                assert.deepStrictEqual(await actual.promise(), value);
            }

            assert.deepStrictEqual(await actual.isKnown, known);
            assert.deepStrictEqual(await actual.isSecret, secret);

            const actualDeps = new Set<pulumi.URN>();
            const resources = await actual.allResources!();
            for (const r of resources) {
                const urn = await r.urn.promise();
                actualDeps.add(urn);
            }
            assert.deepStrictEqual(actualDeps, new Set<pulumi.URN>(deps ?? []));
        }

        function createSecret(value: any) {
            return {
                [pulumi.runtime.specialSigKey]: pulumi.runtime.specialSecretSig,
                value,
            };
        }

        function createResourceRef(urn: pulumi.URN, id?: pulumi.ID) {
            return {
                [pulumi.runtime.specialSigKey]: pulumi.runtime.specialResourceSig,
                urn,
                ...(id && { id }),
            };
        }

        function createOutputValue(value?: any, secret?: boolean, dependencies?: pulumi.URN[]) {
            return {
                [pulumi.runtime.specialSigKey]: pulumi.runtime.specialOutputValueSig,
                ...(value !== undefined && { value }),
                ...(secret && { secret }),
                ...(dependencies && { dependencies }),
            };
        }

        const testURN = "urn:pulumi:stack::project::test:index:TestResource::name";
        const testID = "name_id";

        const tests: {
            name: string;
            input: any;
            deps?: string[];
            expected?: any;
            assert?: (actual: any) => Promise<void>;
        }[] = [
            {
                name: "unknown",
                input: pulumi.runtime.unknownValue,
                deps: ["fakeURN"],
                assert: async (actual) => {
                    await assertOutputEqual(actual, undefined, false, false, ["fakeURN"]);
                },
            },
            {
                name: "array nested unknown",
                input: [pulumi.runtime.unknownValue],
                deps: ["fakeURN"],
                assert: async (actual) => {
                    await assertOutputEqual(actual, undefined, false, false, ["fakeURN"]);
                },
            },
            {
                name: "object nested unknown",
                input: { foo: pulumi.runtime.unknownValue },
                deps: ["fakeURN"],
                assert: async (actual) => {
                    await assertOutputEqual(actual, undefined, false, false, ["fakeURN"]);
                },
            },
            {
                name: "unknown output value",
                input: createOutputValue(undefined, false, ["fakeURN"]),
                deps: ["fakeURN"],
                assert: async (actual) => {
                    await assertOutputEqual(actual, undefined, false, false, ["fakeURN"]);
                },
            },
            {
                name: "unknown output value (no deps)",
                input: createOutputValue(),
                assert: async (actual) => {
                    await assertOutputEqual(actual, undefined, false, false);
                },
            },
            {
                name: "array nested unknown output value",
                input: [createOutputValue(undefined, false, ["fakeURN"])],
                deps: ["fakeURN"],
                assert: async (actual) => {
                    assert.ok(Array.isArray(actual));
                    await assertOutputEqual(actual[0], undefined, false, false, ["fakeURN"]);
                },
            },
            {
                name: "array nested unknown output value (no deps)",
                input: [createOutputValue(undefined, false, ["fakeURN"])],
                assert: async (actual) => {
                    assert.ok(Array.isArray(actual));
                    await assertOutputEqual(actual[0], undefined, false, false, ["fakeURN"]);
                },
            },
            {
                name: "object nested unknown output value",
                input: { foo: createOutputValue(undefined, false, ["fakeURN"]) },
                deps: ["fakeURN"],
                assert: async (actual) => {
                    assert.ok(!pulumi.Output.isInstance(actual));
                    await assertOutputEqual(actual.foo, undefined, false, false, ["fakeURN"]);
                },
            },
            {
                name: "object nested unknown output value (no deps)",
                input: { foo: createOutputValue(undefined, false, ["fakeURN"]) },
                assert: async (actual) => {
                    assert.ok(!pulumi.Output.isInstance(actual));
                    await assertOutputEqual(actual.foo, undefined, false, false, ["fakeURN"]);
                },
            },
            {
                name: "string value (no deps)",
                input: "hi",
                expected: "hi",
            },
            {
                name: "array nested string value (no deps)",
                input: ["hi"],
                expected: ["hi"],
            },
            {
                name: "object nested string value (no deps)",
                input: { foo: "hi" },
                expected: { foo: "hi" },
            },
            {
                name: "string output value",
                input: createOutputValue("hi", false, ["fakeURN"]),
                deps: ["fakeURN"],
                assert: async (actual) => {
                    await assertOutputEqual(actual, "hi", true, false, ["fakeURN"]);
                },
            },
            {
                name: "string output value (no deps)",
                input: createOutputValue("hi"),
                assert: async (actual) => {
                    await assertOutputEqual(actual, "hi", true, false);
                },
            },
            {
                name: "array nested string output value",
                input: [createOutputValue("hi", false, ["fakeURN"])],
                deps: ["fakeURN"],
                assert: async (actual) => {
                    assert.ok(Array.isArray(actual));
                    await assertOutputEqual(actual[0], "hi", true, false, ["fakeURN"]);
                },
            },
            {
                name: "array nested string output value (no deps)",
                input: [createOutputValue("hi", false, ["fakeURN"])],
                assert: async (actual) => {
                    assert.ok(Array.isArray(actual));
                    await assertOutputEqual(actual[0], "hi", true, false, ["fakeURN"]);
                },
            },
            {
                name: "object nested string output value",
                input: { foo: createOutputValue("hi", false, ["fakeURN"]) },
                deps: ["fakeURN"],
                assert: async (actual) => {
                    assert.ok(!pulumi.Output.isInstance(actual));
                    await assertOutputEqual(actual.foo, "hi", true, false, ["fakeURN"]);
                },
            },
            {
                name: "object nested string output value (no deps)",
                input: { foo: createOutputValue("hi", false, ["fakeURN"]) },
                assert: async (actual) => {
                    assert.ok(!pulumi.Output.isInstance(actual));
                    await assertOutputEqual(actual.foo, "hi", true, false, ["fakeURN"]);
                },
            },
            {
                name: "string secret (no deps)",
                input: createSecret("shh"),
                assert: async (actual) => {
                    await assertOutputEqual(actual, "shh", true, true);
                },
            },
            {
                name: "array nested string secret (no deps)",
                input: [createSecret("shh")],
                assert: async (actual) => {
                    await assertOutputEqual(actual, ["shh"], true, true);
                },
            },
            {
                name: "object nested string secret (no deps)",
                input: { foo: createSecret("shh") },
                assert: async (actual) => {
                    await assertOutputEqual(actual, { foo: "shh" }, true, true);
                },
            },
            {
                name: "string secret output value (no deps)",
                input: createOutputValue("shh", true),
                assert: async (actual) => {
                    await assertOutputEqual(actual, "shh", true, true);
                },
            },
            {
                name: "array nested string secret output value (no deps)",
                input: [createOutputValue("shh", true)],
                assert: async (actual) => {
                    assert.ok(Array.isArray(actual));
                    await assertOutputEqual(actual[0], "shh", true, true);
                },
            },
            {
                name: "object nested string secret output value (no deps)",
                input: { foo: createOutputValue("shh", true) },
                assert: async (actual) => {
                    assert.ok(!pulumi.Output.isInstance(actual));
                    await assertOutputEqual(actual.foo, "shh", true, true);
                },
            },
            {
                name: "string secret output value",
                input: createOutputValue("shh", true, ["fakeURN1", "fakeURN2"]),
                deps: ["fakeURN1", "fakeURN2"],
                assert: async (actual) => {
                    await assertOutputEqual(actual, "shh", true, true, ["fakeURN1", "fakeURN2"]);
                },
            },
            {
                name: "string secret output value (no deps)",
                input: createOutputValue("shh", true, ["fakeURN1", "fakeURN2"]),
                assert: async (actual) => {
                    await assertOutputEqual(actual, "shh", true, true, ["fakeURN1", "fakeURN2"]);
                },
            },
            {
                name: "array nested string secret output value",
                input: [createOutputValue("shh", true, ["fakeURN1", "fakeURN2"])],
                deps: ["fakeURN1", "fakeURN2"],
                assert: async (actual) => {
                    assert.ok(Array.isArray(actual));
                    await assertOutputEqual(actual[0], "shh", true, true, ["fakeURN1", "fakeURN2"]);
                },
            },
            {
                name: "array nested string secret output value (no deps)",
                input: [createOutputValue("shh", true, ["fakeURN1", "fakeURN2"])],
                assert: async (actual) => {
                    assert.ok(Array.isArray(actual));
                    await assertOutputEqual(actual[0], "shh", true, true, ["fakeURN1", "fakeURN2"]);
                },
            },
            {
                name: "object nested string secret output value",
                input: { foo: createOutputValue("shh", true, ["fakeURN1", "fakeURN2"]) },
                deps: ["fakeURN1", "fakeURN2"],
                assert: async (actual) => {
                    assert.ok(!pulumi.Output.isInstance(actual));
                    await assertOutputEqual(actual.foo, "shh", true, true, ["fakeURN1", "fakeURN2"]);
                },
            },
            {
                name: "object nested string secret output value (no deps)",
                input: { foo: createOutputValue("shh", true, ["fakeURN1", "fakeURN2"]) },
                assert: async (actual) => {
                    assert.ok(!pulumi.Output.isInstance(actual));
                    await assertOutputEqual(actual.foo, "shh", true, true, ["fakeURN1", "fakeURN2"]);
                },
            },
            {
                name: "resource ref",
                input: createResourceRef(testURN, testID),
                deps: [testURN],
                assert: async (actual) => {
                    assert.ok(actual instanceof TestResource);
                    assert.deepStrictEqual(await actual.urn.promise(), testURN);
                    assert.deepStrictEqual(await actual.id.promise(), testID);
                },
            },
            {
                name: "resource ref (no deps)",
                input: createResourceRef(testURN, testID),
                assert: async (actual) => {
                    assert.ok(actual instanceof TestResource);
                    assert.deepStrictEqual(await actual.urn.promise(), testURN);
                    assert.deepStrictEqual(await actual.id.promise(), testID);
                },
            },
            {
                name: "array nested resource ref",
                input: [createResourceRef(testURN, testID)],
                deps: [testURN],
                assert: async (actual) => {
                    await assertOutputEqual(
                        actual,
                        async (v: any) => {
                            assert.ok(Array.isArray(v));
                            assert.ok(v[0] instanceof TestResource);
                            assert.deepStrictEqual(await v[0].urn.promise(), testURN);
                            assert.deepStrictEqual(await v[0].id.promise(), testID);
                        },
                        true,
                        false,
                        [testURN],
                    );
                },
            },
            {
                name: "array nested resource ref (no deps)",
                input: [createResourceRef(testURN, testID)],
                assert: async (actual) => {
                    assert.ok(Array.isArray(actual));
                    assert.ok(actual[0] instanceof TestResource);
                    assert.deepStrictEqual(await actual[0].urn.promise(), testURN);
                    assert.deepStrictEqual(await actual[0].id.promise(), testID);
                },
            },
            {
                name: "object nested resource ref",
                input: { foo: createResourceRef(testURN, testID) },
                deps: [testURN],
                assert: async (actual) => {
                    await assertOutputEqual(
                        actual,
                        async (v: any) => {
                            assert.ok(v.foo instanceof TestResource);
                            assert.deepStrictEqual(await v.foo.urn.promise(), testURN);
                            assert.deepStrictEqual(await v.foo.id.promise(), testID);
                        },
                        true,
                        false,
                        [testURN],
                    );
                },
            },
            {
                name: "object nested resource ref (no deps)",
                input: { foo: createResourceRef(testURN, testID) },
                assert: async (actual) => {
                    assert.ok(actual.foo instanceof TestResource);
                    assert.deepStrictEqual(await actual.foo.urn.promise(), testURN);
                    assert.deepStrictEqual(await actual.foo.id.promise(), testID);
                },
            },
            {
                name: "object nested resource ref and secret",
                input: {
                    foo: createResourceRef(testURN, testID),
                    bar: createSecret("shh"),
                },
                deps: [testURN],
                assert: async (actual) => {
                    // Because there's a nested secret, the top-level property is an output.
                    await assertOutputEqual(
                        actual,
                        async (v: any) => {
                            assert.ok(v.foo instanceof TestResource);
                            assert.deepStrictEqual(await v.foo.urn.promise(), testURN);
                            assert.deepStrictEqual(await v.foo.id.promise(), testID);
                            assert.deepStrictEqual(v.bar, "shh");
                        },
                        true,
                        true,
                        [testURN],
                    );
                },
            },
            {
                name: "object nested resource ref and secret output value",
                input: {
                    foo: createResourceRef(testURN, testID),
                    bar: createOutputValue("shh", true),
                },
                deps: [testURN],
                assert: async (actual) => {
                    assert.ok(!pulumi.Output.isInstance(actual));
                    assert.ok(actual.foo instanceof TestResource);
                    assert.deepStrictEqual(await actual.foo.urn.promise(), testURN);
                    assert.deepStrictEqual(await actual.foo.id.promise(), testID);
                    await assertOutputEqual(actual.bar, "shh", true, true);
                },
            },
            {
                name: "object nested resource ref and secret output value (no deps)",
                input: {
                    foo: createResourceRef(testURN, testID),
                    bar: createOutputValue("shh", true),
                },
                assert: async (actual) => {
                    assert.ok(!pulumi.Output.isInstance(actual));
                    assert.ok(actual.foo instanceof TestResource);
                    assert.deepStrictEqual(await actual.foo.urn.promise(), testURN);
                    assert.deepStrictEqual(await actual.foo.id.promise(), testID);
                    await assertOutputEqual(actual.bar, "shh", true, true);
                },
            },
        ];
        for (const test of tests) {
            it(`deserializes '${test.name}' correctly`, async () => {
                pulumi.runtime.setMocks(new TestMocks(), "project", "stack", true);
                pulumi.runtime.registerResourceModule("test", "index", new TestModule());
                new TestResource("name"); // Create an instance so it can be deserialized.

                const inputs = { value: test.input };
                const inputsStruct = gstruct.Struct.fromJavaScript(inputs);
                const inputDependencies = {
                    get: () => ({
                        getUrnsList: () => test.deps,
                    }),
                };
                const result = await pulumi.provider.deserializeInputs(inputsStruct, inputDependencies);
                const actual = result["value"];

                if (test.assert) {
                    await test.assert(actual);
                } else {
                    assert.deepStrictEqual(actual, test.expected);
                }
            });
        }
    });

    describe("containsOutputs", () => {
        const tests: {
            name: string;
            input: any;
            expected: boolean;
        }[] = [
            {
                name: "Output",
                input: pulumi.Output.create("hi"),
                expected: true,
            },
            {
                name: "[Output]",
                input: [pulumi.Output.create("hi")],
                expected: true,
            },
            {
                name: "{ foo: Output }",
                input: { foo: pulumi.Output.create("hi") },
                expected: true,
            },
            {
                name: "Resource",
                input: new pulumi.DependencyResource("fakeURN"),
                expected: false,
            },
            {
                name: "[Resource]",
                input: [new pulumi.DependencyResource("fakeURN")],
                expected: false,
            },
            {
                name: "{ foo: Resource }",
                input: { foo: new pulumi.DependencyResource("fakeURN") },
                expected: false,
            },
        ];
        for (const test of tests) {
            it(`${test.name} should return ${test.expected}`, () => {
                const actual = pulumi.provider.containsOutputs(test.input);
                assert.strictEqual(actual, test.expected);
            });
        }
    });
});
