function CreateNavigationState() as Object
    return { stack: [], selectedDestination: "home" }
end function

sub PushNavigation(state as Object, screenName as String, context = invalid as Dynamic)
    state.stack.Push({ name: screenName, context: context })
end sub

function PopNavigation(state as Object) as Dynamic
    if state.stack.Count() <= 1 then return invalid
    state.stack.Pop()
    return state.stack[state.stack.Count() - 1]
end function

function CurrentNavigation(state as Object) as Dynamic
    if state.stack.Count() = 0 then return invalid
    return state.stack[state.stack.Count() - 1]
end function

