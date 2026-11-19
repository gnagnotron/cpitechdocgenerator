import unittest

import scpi_iflow_doc_generator as generator


def make_process(step_ids: list[str], connections: list[tuple[str, str]]) -> dict:
    steps = [
        {
            "id": step_id,
            "name": step_id,
            "bpmn_type": "startEvent" if step_id.startswith("start") else "serviceTask",
            "incoming": [],
            "outgoing": [],
        }
        for step_id in step_ids
    ]
    steps_by_id = {step["id"]: step for step in steps}
    sequence_flows = []
    for index, (source_id, target_id) in enumerate(connections):
        flow_id = f"flow-{index}"
        steps_by_id[source_id]["outgoing"].append(flow_id)
        steps_by_id[target_id]["incoming"].append(flow_id)
        sequence_flows.append(
            {
                "id": flow_id,
                "source_ref": source_id,
                "target_ref": target_id,
            }
        )
    return {
        "id": "process",
        "name": "Integration Process",
        "steps": steps,
        "connections": sequence_flows,
    }


def step_order(process: dict) -> list[str]:
    return [step["id"] for step in generator.order_process_steps(process)]


class StepOrderingTests(unittest.TestCase):
    def test_orders_a_linear_flow_by_connections_not_xml_element_order(self):
        process = make_process(
            ["end", "second", "start-main", "first"],
            [
                ("start-main", "first"),
                ("first", "second"),
                ("second", "end"),
            ],
        )

        self.assertEqual(step_order(process), ["start-main", "first", "second", "end"])

    def test_orders_disconnected_components_from_each_root(self):
        process = make_process(
            ["start-main", "second-component", "first-component", "next-main"],
            [
                ("start-main", "next-main"),
                ("first-component", "second-component"),
            ],
        )

        ordered_ids = step_order(process)
        self.assertLess(ordered_ids.index("first-component"), ordered_ids.index("second-component"))
        self.assertLess(ordered_ids.index("start-main"), ordered_ids.index("next-main"))

    def test_places_a_join_after_all_branch_inputs(self):
        process = make_process(
            ["end", "join", "branch-b", "gateway", "start-main", "branch-a"],
            [
                ("start-main", "gateway"),
                ("gateway", "branch-a"),
                ("gateway", "branch-b"),
                ("branch-a", "join"),
                ("branch-b", "join"),
                ("join", "end"),
            ],
        )

        ordered_ids = step_order(process)
        self.assertEqual(len(ordered_ids), len(set(ordered_ids)))
        for source_id, target_id in (
            ("start-main", "gateway"),
            ("gateway", "branch-a"),
            ("gateway", "branch-b"),
            ("branch-a", "join"),
            ("branch-b", "join"),
            ("join", "end"),
        ):
            self.assertLess(ordered_ids.index(source_id), ordered_ids.index(target_id))

    def test_keeps_steps_after_a_loop_after_the_cycle(self):
        process = make_process(
            ["after-loop", "loop-a", "loop-b"],
            [("loop-a", "loop-b"), ("loop-b", "loop-a"), ("loop-b", "after-loop")],
        )

        ordered_ids = step_order(process)
        self.assertEqual(set(ordered_ids), {"after-loop", "loop-a", "loop-b"})
        self.assertLess(ordered_ids.index("loop-a"), ordered_ids.index("loop-b"))
        self.assertLess(ordered_ids.index("loop-b"), ordered_ids.index("after-loop"))

    def test_router_inventory_uses_process_step_order(self):
        process = make_process(
            ["gateway-b", "task", "start-main", "gateway-a"],
            [
                ("start-main", "gateway-a"),
                ("gateway-a", "task"),
                ("task", "gateway-b"),
            ],
        )
        for step in process["steps"]:
            if step["id"].startswith("gateway"):
                step["bpmn_type"] = "exclusiveGateway"
        model = {"processes": [process]}

        routers = generator.find_router_details(model["processes"])

        self.assertEqual([router["id"] for router in routers], ["gateway-a", "gateway-b"])

    def test_resource_usage_lists_steps_in_process_order(self):
        process = make_process(
            ["second", "start-main", "first"],
            [("start-main", "first"), ("first", "second")],
        )
        for step in process["steps"]:
            step["properties"] = {"resource": "common.groovy"}

        resources = generator.detect_resource_usage(
            [{"name": "common.groovy"}],
            [process],
            [],
            [],
        )
        step_locations = [
            location
            for location in resources[0]["used_by"]
            if location.startswith("Step:")
        ]

        self.assertEqual(step_locations, ["Step: start-main", "Step: first", "Step: second"])


if __name__ == "__main__":
    unittest.main()
